// Second-factor enrollment & management (spec §6.2). Authenticated functions
// (not HTTP actions — no per-IP rate-limit need). The login-time verification of
// these factors lives in the /auth/* HTTP actions (convex/http.ts).
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { AppError } from "@stwrd/shared";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { action, query } from "./_generated/server";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { currentUserId } from "./lib/permissions";
import { generateRecoveryCodes, hashToken } from "./lib/tokens";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "./lib/totp";

/** My current 2FA enrollment status (for account settings UI). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      totpEnrolled: Boolean(tf?.totpEnabledAt),
      recoveryCodesRemaining: tf?.recoveryCodeHashes.length ?? 0,
    };
  },
});

/**
 * Begin TOTP enrollment: generate a secret, store it encrypted (staged, not yet
 * enabled), and return the otpauth URI + secret for QR display. The user must
 * confirm a code before it becomes active.
 */
export const startTotpEnrollment = action({
  args: {},
  handler: async (ctx): Promise<{ secret: string; uri: string }> => {
    const userId = await getAuthedUserId(ctx);
    const secret = generateTotpSecret();
    await ctx.runMutation(internal.authInternal.stageTotpSecret, {
      userId,
      secretEnc: await encryptSecret(secret),
    });
    const settings = await ctx.runQuery(internal.twofactorInternal.orgAndEmail, {
      userId,
    });
    return {
      secret,
      uri: totpAuthUri(secret, settings.email, settings.orgName),
    };
  },
});

/**
 * Confirm TOTP enrollment by verifying a code against the staged secret. On
 * success, TOTP is enabled and a fresh set of single-use recovery codes is
 * generated and returned EXACTLY ONCE (§23.1).
 */
export const confirmTotpEnrollment = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ recoveryCodes: string[] }> => {
    const userId = await getAuthedUserId(ctx);
    const secretEnc = await ctx.runQuery(internal.authInternal.getTotpSecretEnc, {
      userId,
    });
    if (!secretEnc) throw new AppError("state_conflict", "no staged TOTP secret");
    const secret = await decryptSecret(secretEnc);
    if (!(await verifyTotp(secret, code))) throw new AppError("validation_failed", "bad code");

    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => hashToken(c)));
    // Enable TOTP and persist recovery codes in one transaction (no half state).
    await ctx.runMutation(internal.authInternal.enableTotpWithRecoveryCodes, {
      userId,
      recoveryCodeHashes: hashes,
    });
    return { recoveryCodes: codes };
  },
});

/** Regenerate recovery codes (voids the prior set, §23.1). Returns them once. */
export const regenerateRecoveryCodes = action({
  args: {},
  handler: async (ctx): Promise<{ recoveryCodes: string[] }> => {
    const userId = await getAuthedUserId(ctx);
    const tf = await ctx.runQuery(internal.twofactorInternal.twoFactorRow, { userId });
    if (!tf?.totpEnrolled) throw new AppError("state_conflict", "TOTP not enrolled");
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => hashToken(c)));
    await ctx.runMutation(internal.authInternal.setRecoveryCodes, { userId, hashes });
    return { recoveryCodes: codes };
  },
});

async function getAuthedUserId(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new AppError("unauthenticated");
  return userId;
}
