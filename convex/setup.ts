// Bootstrap setup wizard (spec §6.3, C-01).
//
// Runs exactly once on a fresh instance (gated on "zero users exist"): creates
// the server-manager account, names the org, chooses the 2FA policy, sets the
// claim-expiry default, seeds the two default roles, and writes the
// instanceSettings singleton. After completion every route leaves /setup and
// /setup itself 404s (enforced by the frontend via settings.setupStatus).
import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  AppError,
  CLAIM_EXPIRY_HOURS_MAX,
  CLAIM_EXPIRY_HOURS_MIN,
  PASSWORD_MIN_LENGTH,
  PHOTO_MAX_EDGE_PX_DEFAULT,
} from "@lot/shared";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { encryptSecret } from "./lib/crypto";
import { seedDefaultRoles } from "./roles";

export const wizard = action({
  args: {
    serverManagerName: v.string(),
    serverManagerEmail: v.string(),
    password: v.string(),
    orgName: v.string(),
    twoFactorPolicy: v.union(v.literal("required"), v.literal("off")),
    claimExpiryHours: v.number(),
    smtp: v.optional(
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
    imap: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
        username: v.string(),
        password: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    if (args.password.length < PASSWORD_MIN_LENGTH) {
      throw new AppError("validation_failed", "password too short");
    }
    if (
      args.claimExpiryHours < CLAIM_EXPIRY_HOURS_MIN ||
      args.claimExpiryHours > CLAIM_EXPIRY_HOURS_MAX
    ) {
      throw new AppError("validation_failed", "claimExpiryHours out of range");
    }

    // Gate: refuse if the instance is already bootstrapped.
    await ctx.runMutation(internal.setup.assertFresh, {});

    const email = args.serverManagerEmail.toLowerCase();
    // Creates the user row (profile) + a credentials account (PBKDF2-hashed).
    const { user } = await createAccount(ctx, {
      provider: "credentials",
      account: { id: email, secret: args.password },
      profile: {
        email,
        name: args.serverManagerName,
        status: "active",
        notificationPref: "in_app",
        defaultExchangePref: null,
        createdAt: Date.now(),
      } as never,
    });

    const smtpEnc = args.smtp
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
    const imapEnc = args.imap
      ? {
          host: args.imap.host,
          port: args.imap.port,
          secure: args.imap.secure,
          username: args.imap.username,
          passwordEnc: await encryptSecret(args.imap.password),
        }
      : undefined;

    await ctx.runMutation(internal.setup.finish, {
      userId: user._id as Id<"users">,
      orgName: args.orgName,
      twoFactorPolicy: args.twoFactorPolicy,
      claimExpiryHours: args.claimExpiryHours,
      smtp: smtpEnc,
      imap: imapEnc,
    });

    return { ok: true };
  },
});

export const assertFresh = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("instanceSettings").first();
    if (existing?.setupCompleted) throw new AppError("state_conflict", "already set up");
    const anyUser = await ctx.db.query("users").first();
    if (anyUser) throw new AppError("state_conflict", "users already exist");
  },
});

const encSecretValidator = v.object({
  ciphertext: v.string(),
  iv: v.string(),
  tag: v.string(),
});

export const finish = internalMutation({
  args: {
    userId: v.id("users"),
    orgName: v.string(),
    twoFactorPolicy: v.union(v.literal("required"), v.literal("off")),
    claimExpiryHours: v.number(),
    smtp: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
        username: v.string(),
        passwordEnc: encSecretValidator,
        fromAddress: v.string(),
        replyToDomain: v.optional(v.string()),
      }),
    ),
    imap: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
        username: v.string(),
        passwordEnc: encSecretValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Seed roles, assign Server Manager to the bootstrap account.
    const { serverManagerRoleId } = await seedDefaultRoles(ctx);
    const existingAssignment = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user_role", (q) =>
        q.eq("userId", args.userId).eq("roleId", serverManagerRoleId),
      )
      .first();
    if (!existingAssignment) {
      await ctx.db.insert("roleAssignments", {
        userId: args.userId,
        roleId: serverManagerRoleId,
      });
    }

    // Write the settings singleton. Re-check completion here to close the TOCTOU
    // window between assertFresh and account creation (concurrent setup attempts).
    const existing = await ctx.db.query("instanceSettings").first();
    if (existing?.setupCompleted) throw new AppError("state_conflict", "already set up");
    const settings = {
      orgName: args.orgName,
      claimExpiryHours: args.claimExpiryHours,
      twoFactorPolicy: args.twoFactorPolicy,
      smtp: args.smtp,
      imap: args.imap,
      branchesEnabled: true,
      photoMaxEdgePx: PHOTO_MAX_EDGE_PX_DEFAULT,
      setupCompleted: true,
    };
    if (existing) {
      await ctx.db.patch(existing._id, settings);
    } else {
      await ctx.db.insert("instanceSettings", settings);
    }

    await ctx.db.insert("auditEvents", {
      actorId: args.userId,
      action: "setup.completed",
      detail: { orgName: args.orgName, twoFactorPolicy: args.twoFactorPolicy },
      createdAt: Date.now(),
    });
  },
});
