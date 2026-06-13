// Instance settings (spec §7.10, §15 Settings panel, §22.2 settings.*).
import { v } from "convex/values";
import {
  AppError,
  CLAIM_EXPIRY_HOURS_MAX,
  CLAIM_EXPIRY_HOURS_MIN,
  PERMISSIONS,
} from "@lot/shared";
import { internalQuery, mutation, query } from "./_generated/server";
import { encryptSecret } from "./lib/crypto";
import { getSettings, isSetupComplete, recordAudit } from "./lib/instance";
import { requirePermission } from "./lib/permissions";

/** Assert the caller may edit settings — used by the Node testSmtp action. */
export const requireSettingsAccess = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.instanceSettings);
    return true;
  },
});

/** Encrypted SMTP config + org name, for the Node send actions only (§13). */
export const smtpForSend = internalQuery({
  args: {},
  handler: async (ctx) => {
    const s = await getSettings(ctx);
    if (!s?.smtp) return null;
    return { orgName: s.orgName, smtp: s.smtp };
  },
});

/** Encrypted IMAP config, for the Node poll action only (§13). */
export const imapForPoll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const s = await getSettings(ctx);
    return s?.imap ?? null;
  },
});

/**
 * Public-shape settings (no secrets). The hostname is read-only here — the
 * single source of truth is PUBLIC_SITE_ORIGIN in the environment (§19.5).
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const s = await getSettings(ctx);
    if (!s) return null;
    return {
      orgName: s.orgName,
      claimExpiryHours: s.claimExpiryHours,
      twoFactorPolicy: s.twoFactorPolicy,
      branchesEnabled: s.branchesEnabled,
      photoMaxEdgePx: s.photoMaxEdgePx,
      accentColor: s.accentColor ?? null,
      smtpConfigured: Boolean(s.smtp),
      imapConfigured: Boolean(s.imap),
      siteOrigin: process.env.SITE_URL ?? null, // read-only display (§19.5)
      setupCompleted: s.setupCompleted,
    };
  },
});

/** Setup gate: do any users exist / is setup complete? Drives /setup (C-01). */
export const setupStatus = query({
  args: {},
  handler: async (ctx) => {
    const anyUser = await ctx.db.query("users").first();
    return {
      setupComplete: await isSetupComplete(ctx),
      hasUsers: anyUser !== null,
    };
  },
});

/**
 * Edit org settings. SMTP/IMAP passwords arrive in plaintext and are encrypted
 * before write (§7.10, §18.1). A null smtp/imap clears the config.
 */
export const update = mutation({
  args: {
    orgName: v.optional(v.string()),
    claimExpiryHours: v.optional(v.number()),
    twoFactorPolicy: v.optional(v.union(v.literal("required"), v.literal("off"))),
    branchesEnabled: v.optional(v.boolean()),
    photoMaxEdgePx: v.optional(v.number()),
    accentColor: v.optional(v.string()),
    smtp: v.optional(
      v.union(
        v.null(),
        v.object({
          host: v.string(),
          port: v.number(),
          secure: v.boolean(),
          username: v.string(),
          password: v.string(),
          fromAddress: v.string(),
          replyToDomain: v.optional(v.string()),
        }),
      ),
    ),
    imap: v.optional(
      v.union(
        v.null(),
        v.object({
          host: v.string(),
          port: v.number(),
          secure: v.boolean(),
          username: v.string(),
          password: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.instanceSettings);
    const s = await getSettings(ctx);
    if (!s) throw new AppError("state_conflict", "setup not complete");

    if (
      args.claimExpiryHours !== undefined &&
      (args.claimExpiryHours < CLAIM_EXPIRY_HOURS_MIN ||
        args.claimExpiryHours > CLAIM_EXPIRY_HOURS_MAX)
    ) {
      throw new AppError("validation_failed", "claimExpiryHours out of range");
    }

    const patch: Record<string, unknown> = {};
    if (args.orgName !== undefined) patch.orgName = args.orgName;
    if (args.claimExpiryHours !== undefined) patch.claimExpiryHours = args.claimExpiryHours;
    if (args.twoFactorPolicy !== undefined) patch.twoFactorPolicy = args.twoFactorPolicy;
    if (args.branchesEnabled !== undefined) patch.branchesEnabled = args.branchesEnabled;
    if (args.photoMaxEdgePx !== undefined) patch.photoMaxEdgePx = args.photoMaxEdgePx;
    if (args.accentColor !== undefined) patch.accentColor = args.accentColor;

    if (args.smtp !== undefined) {
      patch.smtp = args.smtp
        ? {
            host: args.smtp.host,
            port: args.smtp.port,
            secure: args.smtp.secure,
            username: args.smtp.username,
            passwordEnc: await encryptSecret(args.smtp.password),
            fromAddress: args.smtp.fromAddress,
            replyToDomain: args.smtp.replyToDomain,
          }
        : undefined;
    }
    if (args.imap !== undefined) {
      patch.imap = args.imap
        ? {
            host: args.imap.host,
            port: args.imap.port,
            secure: args.imap.secure,
            username: args.imap.username,
            passwordEnc: await encryptSecret(args.imap.password),
          }
        : undefined;
    }

    await ctx.db.patch(s._id, patch);
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "settings.update",
      detail: { fields: Object.keys(patch) },
    });
  },
});
