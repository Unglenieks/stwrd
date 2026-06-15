// Internal auth state operations (spec §6). These run in the default runtime
// (DB + Web Crypto) and are called by the /auth/* HTTP actions and by the
// credentials provider's `authorize`. None are exposed to clients.
import { v } from "convex/values";
import {
  AppError,
  EMAIL_OTP_LOCKOUT_MS,
  EMAIL_OTP_MAX_ATTEMPTS,
} from "@stwrd/shared";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { enqueueEmail } from "./email";
import { userIsFullPermission } from "./lib/permissions";

// ── Users / lookup ───────────────────────────────────────────────────────────

export const userByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.toLowerCase()))
      .first();
    if (!user) return null;
    return { userId: user._id, status: user.status ?? "active", name: user.name ?? "" };
  },
});

export const isFullPermission = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => userIsFullPermission(ctx, userId),
});

/**
 * Everything the login flow needs to decide whether a second factor is required
 * for this user (§6.2): org policy, SMTP availability, TOTP enrollment, recovery
 * codes, and whether the account holds a full-permission role.
 */
export const authContext = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const settings = await ctx.db.query("instanceSettings").first();
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      policy: settings?.twoFactorPolicy ?? "required",
      smtpConfigured: Boolean(settings?.smtp),
      totpEnrolled: Boolean(tf?.totpEnabledAt),
      recoveryCount: tf?.recoveryCodeHashes.length ?? 0,
      isFull: await userIsFullPermission(ctx, userId),
    };
  },
});

/** Second-factor enrollment summary (no secrets) used by the policy decision. */
export const twoFactorState = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      totpEnrolled: Boolean(tf?.totpEnabledAt),
      recoveryCount: tf?.recoveryCodeHashes.length ?? 0,
    };
  },
});

// ── Pending (completion) tokens ──────────────────────────────────────────────

export const issuePending = internalMutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
    ttlMs: v.number(),
    secondFactorSatisfied: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mfaPending", {
      userId: args.userId,
      tokenHash: args.tokenHash,
      expiresAt: Date.now() + args.ttlMs,
      consumed: false,
      secondFactorSatisfied: args.secondFactorSatisfied,
      createdAt: Date.now(),
    });
  },
});

export const pendingByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db
      .query("mfaPending")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row) return null;
    return {
      userId: row.userId,
      expired: row.expiresAt < Date.now(),
      consumed: row.consumed,
      secondFactorSatisfied: row.secondFactorSatisfied,
    };
  },
});

export const markPendingSatisfied = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db
      .query("mfaPending")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (row && !row.consumed) await ctx.db.patch(row._id, { secondFactorSatisfied: true });
  },
});

/**
 * Validate + consume a completion token, returning the userId to mint a session.
 * Hashing happens here so the raw token never round-trips through another fn.
 */
export const consumeCompletionToken = internalMutation({
  args: { rawToken: v.string() },
  handler: async (ctx, { rawToken }): Promise<Id<"users"> | null> => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken) as BufferSource,
    );
    const tokenHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const row = await ctx.db
      .query("mfaPending")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row) return null;
    if (row.consumed || row.expiresAt < Date.now() || !row.secondFactorSatisfied) return null;
    await ctx.db.patch(row._id, { consumed: true });
    return row.userId;
  },
});

// ── Email OTP (§6.2, §23.1: 6 digits, 10 min, 5 attempts → 15-min lockout) ───

export const createEmailOtp = internalMutation({
  args: { userId: v.id("users"), codeHash: v.string(), ttlMs: v.number() },
  handler: async (ctx, args) => {
    // Replace any prior challenge for this user.
    const prior = await ctx.db
      .query("emailOtp")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const p of prior) await ctx.db.delete(p._id);
    await ctx.db.insert("emailOtp", {
      userId: args.userId,
      codeHash: args.codeHash,
      expiresAt: Date.now() + args.ttlMs,
      attempts: 0,
      consumed: false,
      createdAt: Date.now(),
    });
  },
});

/** Store a hashed email OTP and enqueue the code to the user's address (§13). */
export const issueEmailOtp = internalMutation({
  args: {
    userId: v.id("users"),
    codeHash: v.string(),
    rawCode: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const user = await ctx.db.get(args.userId);
    if (!user?.email) return false;
    const prior = await ctx.db
      .query("emailOtp")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const p of prior) await ctx.db.delete(p._id);
    await ctx.db.insert("emailOtp", {
      userId: args.userId,
      codeHash: args.codeHash,
      expiresAt: Date.now() + args.ttlMs,
      attempts: 0,
      consumed: false,
      createdAt: Date.now(),
    });
    await enqueueEmail(ctx, {
      to: user.email,
      template: "otp",
      payload: { code: args.rawCode },
    });
    return true;
  },
});

export const consumeEmailOtp = internalMutation({
  args: { userId: v.id("users"), codeHash: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<"ok" | "expired" | "locked" | "mismatch" | "none"> => {
    const row = await ctx.db
      .query("emailOtp")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!row || row.consumed) return "none";
    const now = Date.now();
    if (row.lockedUntil && row.lockedUntil > now) return "locked";
    if (row.expiresAt < now) return "expired";
    if (row.codeHash === args.codeHash) {
      await ctx.db.patch(row._id, { consumed: true });
      return "ok";
    }
    const attempts = row.attempts + 1;
    const patch: Record<string, unknown> = { attempts };
    if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) patch.lockedUntil = now + EMAIL_OTP_LOCKOUT_MS;
    await ctx.db.patch(row._id, patch);
    return attempts >= EMAIL_OTP_MAX_ATTEMPTS ? "locked" : "mismatch";
  },
});

// ── TOTP secret + recovery codes ─────────────────────────────────────────────

export const getTotpSecretEnc = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return tf?.totpSecretEnc ?? null;
  },
});

export const stageTotpSecret = internalMutation({
  args: {
    userId: v.id("users"),
    secretEnc: v.object({ ciphertext: v.string(), iv: v.string(), tag: v.string() }),
  },
  handler: async (ctx, { userId, secretEnc }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (tf) {
      await ctx.db.patch(tf._id, { totpSecretEnc: secretEnc });
    } else {
      await ctx.db.insert("twoFactor", {
        userId,
        totpSecretEnc: secretEnc,
        recoveryCodeHashes: [],
      });
    }
  },
});

/**
 * Atomically enable TOTP and store the freshly-generated recovery-code hashes,
 * so enrollment never lands in a half-completed state (enabled without recovery
 * codes, or vice-versa). Throws if no staged secret exists.
 */
export const enableTotpWithRecoveryCodes = internalMutation({
  args: { userId: v.id("users"), recoveryCodeHashes: v.array(v.string()) },
  handler: async (ctx, { userId, recoveryCodeHashes }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!tf || !tf.totpSecretEnc) {
      throw new AppError("state_conflict", "no staged TOTP secret");
    }
    await ctx.db.patch(tf._id, {
      totpEnabledAt: Date.now(),
      recoveryCodeHashes,
    });
  },
});

export const setRecoveryCodes = internalMutation({
  args: { userId: v.id("users"), hashes: v.array(v.string()) },
  handler: async (ctx, { userId, hashes }) => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (tf) {
      await ctx.db.patch(tf._id, { recoveryCodeHashes: hashes });
    } else {
      await ctx.db.insert("twoFactor", { userId, recoveryCodeHashes: hashes });
    }
  },
});

export const consumeRecoveryCode = internalMutation({
  args: { userId: v.id("users"), codeHash: v.string() },
  handler: async (ctx, { userId, codeHash }): Promise<boolean> => {
    const tf = await ctx.db
      .query("twoFactor")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!tf) return false;
    const idx = tf.recoveryCodeHashes.indexOf(codeHash);
    if (idx === -1) return false;
    const remaining = tf.recoveryCodeHashes.filter((_, i) => i !== idx);
    await ctx.db.patch(tf._id, { recoveryCodeHashes: remaining });
    return true;
  },
});

// ── Invites (§6.1) ───────────────────────────────────────────────────────────

export const inviteByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db
      .query("invites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row) return null;
    return {
      inviteId: row._id,
      userId: row.userId,
      email: row.email,
      name: row.name,
      expired: row.expiresAt < Date.now(),
      accepted: Boolean(row.acceptedAt),
    };
  },
});

export const acceptInvite = internalMutation({
  args: { inviteId: v.id("invites"), userId: v.id("users") },
  handler: async (ctx, { inviteId, userId }) => {
    await ctx.db.patch(inviteId, { acceptedAt: Date.now() });
    await ctx.db.patch(userId, { status: "active", emailVerificationTime: Date.now() });
    // Assign the Member default role so new accounts get the baseline set (§5.1).
    const memberRole = (await ctx.db.query("roles").collect()).find(
      (r) => r.isSystemDefault && r.name === "Member",
    );
    if (memberRole) {
      const existing = await ctx.db
        .query("roleAssignments")
        .withIndex("by_user_role", (q) =>
          q.eq("userId", userId).eq("roleId", memberRole._id),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("roleAssignments", { userId, roleId: memberRole._id });
      }
    }
  },
});

// ── Per-IP / per-account rate limiting (§18.1) ───────────────────────────────

export const bumpRateLimit = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    lockoutMs: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ allowed: boolean; lockedUntil?: number }> => {
    const now = Date.now();
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!row) {
      await ctx.db.insert("rateLimits", { key: args.key, count: 1, windowStartedAt: now });
      return { allowed: true };
    }
    if (row.lockedUntil && row.lockedUntil > now) {
      return { allowed: false, lockedUntil: row.lockedUntil };
    }
    // Reset window if elapsed.
    if (now - row.windowStartedAt > args.windowMs) {
      await ctx.db.patch(row._id, { count: 1, windowStartedAt: now, lockedUntil: undefined });
      return { allowed: true };
    }
    const count = row.count + 1;
    if (count > args.limit) {
      const lockedUntil = now + args.lockoutMs;
      await ctx.db.patch(row._id, { count, lockedUntil });
      return { allowed: false, lockedUntil };
    }
    await ctx.db.patch(row._id, { count });
    return { allowed: true };
  },
});
