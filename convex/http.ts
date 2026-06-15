// HTTP router + auth endpoints (spec §6.2, §18.1, §22.1).
//
// The /auth/* routes are HTTP actions specifically so the backend sees
// `X-Forwarded-For` from the proxy for per-IP rate limiting (WebSocket mutations
// never see client IPs — §6.2). They implement the second-factor elevation state
// machine; the actual session is minted by the frontend calling Convex Auth's
// `signIn("credentials", { completionToken })` with the token these endpoints
// return only after every required factor passes.
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { httpRouter } from "convex/server";
import {
  AppError,
  EMAIL_OTP_TTL_MS,
  ERROR_MESSAGES,
  isErrorCode,
  MFA_PENDING_TOKEN_TTL_MS,
  PASSWORD_MIN_LENGTH,
  type ErrorCode,
} from "@stwrd/shared";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { decryptSecret } from "./lib/crypto";
import { generateNumericOtp, generateToken, hashToken } from "./lib/tokens";
import { verifyTotp } from "./lib/totp";

const http = httpRouter();
auth.addHttpRoutes(http);

// Rate-limit tuning (not normative §23.1 constants — login/OTP hardening knobs).
const LOGIN_IP_LIMIT = 30;
const LOGIN_ACCT_LIMIT = 10;
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_LOCKOUT_MS = 15 * 60 * 1000;
const OTP_SEND_LIMIT = 5;
const MFA_VERIFY_LIMIT = 10;

function corsHeaders(): Record<string, string> {
  const origin = process.env.SITE_URL ?? "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  // The credentials header is invalid alongside a wildcard origin and makes
  // browsers reject the response — only send it for a concrete origin.
  if (origin !== "*") headers["Access-Control-Allow-Credentials"] = "true";
  return headers;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  validation_failed: 400,
  smtp_unconfigured: 409,
};

function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return json(
      { error: err.code, message: ERROR_MESSAGES[err.code] },
      ERROR_STATUS[err.code] ?? 400,
    );
  }
  const code = err instanceof Error && isErrorCode(err.message) ? err.message : null;
  if (code) return json({ error: code, message: ERROR_MESSAGES[code] }, ERROR_STATUS[code] ?? 400);
  // Anything unexpected (e.g. retrieveAccount throwing on wrong password) is a
  // generic auth failure to the client — never leak detail — but log it
  // server-side so operators can diagnose.
  console.error("auth action error:", err);
  return json({ error: "unauthenticated", message: ERROR_MESSAGES.unauthenticated }, 401);
}

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ── POST /auth/login ─────────────────────────────────────────────────────────
const login = httpAction(async (ctx, request) => {
  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") {
      throw new AppError("validation_failed");
    }
    const normEmail = email.toLowerCase().trim();
    const ip = clientIp(request);

    const ipRl = await ctx.runMutation(internal.authInternal.bumpRateLimit, {
      key: `login:ip:${ip}`,
      limit: LOGIN_IP_LIMIT,
      windowMs: RL_WINDOW_MS,
      lockoutMs: RL_LOCKOUT_MS,
    });
    if (!ipRl.allowed) throw new AppError("rate_limited");
    const acctRl = await ctx.runMutation(internal.authInternal.bumpRateLimit, {
      key: `login:acct:${normEmail}`,
      limit: LOGIN_ACCT_LIMIT,
      windowMs: RL_WINDOW_MS,
      lockoutMs: RL_LOCKOUT_MS,
    });
    if (!acctRl.allowed) throw new AppError("rate_limited");

    // Verify password (throws on mismatch, null if no such account).
    const retrieved = await retrieveAccount(ctx, {
      provider: "credentials",
      account: { id: normEmail, secret: password },
    }).catch(() => null);
    if (!retrieved) throw new AppError("unauthenticated");

    const lookup = await ctx.runQuery(internal.authInternal.userByEmail, {
      email: normEmail,
    });
    if (!lookup || lookup.status !== "active") throw new AppError("unauthenticated");
    const userId = lookup.userId;

    const actx = await ctx.runQuery(internal.authInternal.authContext, { userId });
    const factorAvailable = actx.smtpConfigured || actx.totpEnrolled;
    const required =
      actx.policy === "required"
        ? true
        : actx.totpEnrolled || (actx.isFull && factorAvailable);

    if (required) {
      const methods: string[] = [];
      if (actx.totpEnrolled) methods.push("totp");
      if (actx.smtpConfigured) methods.push("otp");
      if (actx.recoveryCount > 0) methods.push("recovery");
      if (methods.length === 0) throw new AppError("smtp_unconfigured");

      const pendingToken = generateToken();
      await ctx.runMutation(internal.authInternal.issuePending, {
        userId,
        tokenHash: await hashToken(pendingToken),
        ttlMs: MFA_PENDING_TOKEN_TTL_MS,
        secondFactorSatisfied: false,
      });
      return json({ status: "mfa_required", pendingToken, methods });
    }

    // No second factor required — issue a ready completion token.
    const completionToken = generateToken();
    await ctx.runMutation(internal.authInternal.issuePending, {
      userId,
      tokenHash: await hashToken(completionToken),
      ttlMs: MFA_PENDING_TOKEN_TTL_MS,
      secondFactorSatisfied: true,
    });
    return json({ status: "complete", completionToken });
  } catch (err) {
    return errorResponse(err);
  }
});

// ── POST /auth/mfa/send-otp ──────────────────────────────────────────────────
const sendOtp = httpAction(async (ctx, request) => {
  try {
    const { pendingToken } = await request.json();
    if (typeof pendingToken !== "string") throw new AppError("validation_failed");
    const pending = await ctx.runQuery(internal.authInternal.pendingByTokenHash, {
      tokenHash: await hashToken(pendingToken),
    });
    if (!pending || pending.expired || pending.consumed) throw new AppError("unauthenticated");

    const actx = await ctx.runQuery(internal.authInternal.authContext, {
      userId: pending.userId,
    });
    if (!actx.smtpConfigured) throw new AppError("smtp_unconfigured");

    const rl = await ctx.runMutation(internal.authInternal.bumpRateLimit, {
      key: `otp:send:${pending.userId}`,
      limit: OTP_SEND_LIMIT,
      windowMs: RL_WINDOW_MS,
      lockoutMs: RL_LOCKOUT_MS,
    });
    if (!rl.allowed) throw new AppError("rate_limited");

    const code = generateNumericOtp();
    await ctx.runMutation(internal.authInternal.issueEmailOtp, {
      userId: pending.userId,
      codeHash: await hashToken(code),
      rawCode: code,
      ttlMs: EMAIL_OTP_TTL_MS,
    });
    return json({ status: "sent" });
  } catch (err) {
    return errorResponse(err);
  }
});

// ── POST /auth/mfa/verify ────────────────────────────────────────────────────
const verifyMfa = httpAction(async (ctx, request) => {
  try {
    const { pendingToken, otp, totp, recoveryCode } = await request.json();
    if (typeof pendingToken !== "string") throw new AppError("validation_failed");
    const tokenHash = await hashToken(pendingToken);
    const pending = await ctx.runQuery(internal.authInternal.pendingByTokenHash, {
      tokenHash,
    });
    if (!pending || pending.expired || pending.consumed) throw new AppError("unauthenticated");
    const userId = pending.userId as Id<"users">;

    const rl = await ctx.runMutation(internal.authInternal.bumpRateLimit, {
      key: `mfa:verify:${userId}`,
      limit: MFA_VERIFY_LIMIT,
      windowMs: RL_WINDOW_MS,
      lockoutMs: RL_LOCKOUT_MS,
    });
    if (!rl.allowed) throw new AppError("rate_limited");

    let satisfied = false;

    if (typeof totp === "string" && totp.length > 0) {
      const secretEnc = await ctx.runQuery(internal.authInternal.getTotpSecretEnc, {
        userId,
      });
      if (!secretEnc) throw new AppError("unauthenticated");
      const secret = await decryptSecret(secretEnc);
      satisfied = await verifyTotp(secret, totp);
    } else if (typeof otp === "string" && otp.length > 0) {
      const result = await ctx.runMutation(internal.authInternal.consumeEmailOtp, {
        userId,
        codeHash: await hashToken(otp),
      });
      if (result === "locked") throw new AppError("rate_limited");
      satisfied = result === "ok";
    } else if (typeof recoveryCode === "string" && recoveryCode.length > 0) {
      const normalized = recoveryCode.toLowerCase().replace(/\s/g, "");
      satisfied = await ctx.runMutation(internal.authInternal.consumeRecoveryCode, {
        userId,
        codeHash: await hashToken(normalized),
      });
    } else {
      throw new AppError("validation_failed");
    }

    if (!satisfied) throw new AppError("unauthenticated");

    await ctx.runMutation(internal.authInternal.markPendingSatisfied, { tokenHash });
    // The pendingToken is now a valid completion token for the session mint.
    return json({ status: "complete", completionToken: pendingToken });
  } catch (err) {
    return errorResponse(err);
  }
});

// ── POST /auth/invite/accept ─────────────────────────────────────────────────
const acceptInvite = httpAction(async (ctx, request) => {
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || typeof password !== "string") {
      throw new AppError("validation_failed");
    }
    if (password.length < PASSWORD_MIN_LENGTH) throw new AppError("validation_failed");

    const invite = await ctx.runQuery(internal.authInternal.inviteByTokenHash, {
      tokenHash: await hashToken(token),
    });
    if (!invite || invite.expired || invite.accepted) throw new AppError("not_found");

    // Attach credentials to the pre-created invited user (linked by verified email).
    await createAccount(ctx, {
      provider: "credentials",
      account: { id: invite.email, secret: password },
      profile: {
        email: invite.email,
        name: invite.name,
        status: "active",
        notificationPref: "in_app",
        defaultExchangePref: null,
        createdAt: Date.now(),
      } as never,
      shouldLinkViaEmail: true,
    });
    await ctx.runMutation(internal.authInternal.acceptInvite, {
      inviteId: invite.inviteId,
      userId: invite.userId,
    });

    const actx = await ctx.runQuery(internal.authInternal.authContext, {
      userId: invite.userId,
    });
    // The invite already proved mailbox control, so we mint the session now and
    // route the member into TOTP enrollment if policy requires a second factor.
    const completionToken = generateToken();
    await ctx.runMutation(internal.authInternal.issuePending, {
      userId: invite.userId,
      tokenHash: await hashToken(completionToken),
      ttlMs: MFA_PENDING_TOKEN_TTL_MS,
      secondFactorSatisfied: true,
    });
    return json({
      status: "complete",
      completionToken,
      enroll2fa: actx.policy === "required",
    });
  } catch (err) {
    return errorResponse(err);
  }
});

// ── POST /auth/logout ────────────────────────────────────────────────────────
// Session teardown is performed by the frontend via Convex Auth's client
// `signOut` (which revokes the refresh token and clears local state). This
// endpoint exists for the §22.1 surface and as an explicit ack; per-device
// revocation lives in account settings (§6.2).
const logout = httpAction(async () => json({ status: "ok" }));

const routes: [string, ReturnType<typeof httpAction>][] = [
  ["/auth/login", login],
  ["/auth/mfa/send-otp", sendOtp],
  ["/auth/mfa/verify", verifyMfa],
  ["/auth/invite/accept", acceptInvite],
  ["/auth/logout", logout],
];
for (const [path, handler] of routes) {
  http.route({ path, method: "POST", handler });
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => preflight()) });
}

export default http;
