// Members: provisioning (invites), profile, deactivation (spec §6.1, §6.4, §16,
// §22.2 users.*).
import { v } from "convex/values";
import {
  AppError,
  INVITE_TOKEN_TTL_MS,
  PERMISSIONS,
} from "@lot/shared";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { enqueueEmail } from "./email";
import { recordAudit } from "./lib/instance";
import { appendLedger } from "./lib/ledger";
import {
  assertNotLastAdminRemoval,
  currentUserId,
  getEffectivePermissions,
  requirePermission,
  requireUser,
} from "./lib/permissions";
import { generateToken, hashToken } from "./lib/tokens";

// ── Current member ───────────────────────────────────────────────────────────

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const u = await ctx.db.get(userId);
    if (!u) return null;
    return {
      _id: u._id,
      name: u.name ?? "",
      email: u.email ?? "",
      status: u.status ?? "active",
      contactPhone: u.contactPhone ?? null,
      defaultExchangePref: u.defaultExchangePref ?? null,
      notificationPref: u.notificationPref ?? "in_app",
      avatarFileId: u.avatarFileId ?? null,
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    contactPhone: v.optional(v.union(v.string(), v.null())),
    defaultExchangePref: v.optional(
      v.union(v.literal("reveal_contact"), v.literal("branch"), v.null()),
    ),
    notificationPref: v.optional(v.union(v.literal("in_app"), v.literal("email"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    // `contactPhone` is an optional string (no null variant), so clearing it
    // means writing `undefined`, which removes the field — that's what a null
    // arg maps to here.
    if (args.contactPhone !== undefined) patch.contactPhone = args.contactPhone ?? undefined;
    if (args.defaultExchangePref !== undefined)
      patch.defaultExchangePref = args.defaultExchangePref;
    if (args.notificationPref !== undefined) patch.notificationPref = args.notificationPref;
    await ctx.db.patch(user._id, patch);
  },
});

// ── Admin: member list ───────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Visible to anyone who can provision or manage members (§15 Members panel).
    const me = await requireUser(ctx);
    const perms = await getEffectivePermissions(ctx, me._id);
    if (!perms.has(PERMISSIONS.usersCreate) && !perms.has(PERMISSIONS.usersManage)) {
      throw new AppError("forbidden");
    }
    const users = await ctx.db.query("users").collect();
    return Promise.all(
      users.map(async (u) => {
        const assignments = await ctx.db
          .query("roleAssignments")
          .withIndex("by_user", (q) => q.eq("userId", u._id))
          .collect();
        const held = await ctx.db
          .query("items")
          .withIndex("by_custodian", (q) => q.eq("custodianId", u._id))
          .collect();
        return {
          _id: u._id,
          name: u.name ?? "",
          email: u.email ?? "",
          status: u.status ?? "active",
          roleIds: assignments.map((a) => a.roleId),
          heldItemCount: held.filter((i) => i.state !== "retired").length,
        };
      }),
    );
  },
});

// ── Invites (§6.1) ───────────────────────────────────────────────────────────

/**
 * Provision a member account and produce a single-use invite link (TTL 72 h).
 * Sent by email if SMTP is configured; the link is always returned so it can be
 * shared out-of-band. Action because it may enqueue email and hashes the token.
 */
export const invite = action({
  args: { name: v.string(), email: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteUrl: string; emailQueued: boolean }> => {
    const rawToken = generateToken();
    const tokenHash = await hashToken(rawToken);
    const site = process.env.SITE_URL ?? "";
    const inviteUrl = `${site}/invite/${rawToken}`;
    const emailQueued: boolean = await ctx.runMutation(internal.users.createInvite, {
      name: args.name,
      email: args.email.toLowerCase(),
      tokenHash,
      inviteUrl,
    });
    return { inviteUrl, emailQueued };
  },
});

export const createInvite = internalMutation({
  args: { name: v.string(), email: v.string(), tokenHash: v.string(), inviteUrl: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const actorId = await currentUserId(ctx);
    if (!actorId) throw new AppError("unauthenticated");
    await requirePermission(ctx, PERMISSIONS.usersCreate);

    // Duplicate active/invited email → validation_failed (§22.2).
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (existing && existing.status !== "inactive") {
      throw new AppError("validation_failed", "email already in use");
    }

    const now = Date.now();
    let userId: Id<"users">;
    if (existing) {
      // Reactivating an inactive email as a fresh invite. Refresh the verified
      // timestamp so account-linking on accept behaves like a new invite.
      await ctx.db.patch(existing._id, {
        name: args.name,
        status: "invited",
        emailVerificationTime: now,
      });
      userId = existing._id;
    } else {
      userId = await ctx.db.insert("users", {
        name: args.name,
        email: args.email,
        status: "invited",
        // The invite link proves mailbox control, so the address is verified for
        // account-linking purposes on accept (§6.2).
        emailVerificationTime: now,
        defaultExchangePref: null,
        notificationPref: "in_app",
        createdAt: now,
      });
    }

    await ctx.db.insert("invites", {
      email: args.email,
      name: args.name,
      tokenHash: args.tokenHash,
      userId,
      invitedBy: actorId,
      expiresAt: now + INVITE_TOKEN_TTL_MS,
      createdAt: now,
    });

    const settings = await ctx.db.query("instanceSettings").first();
    const smtpConfigured = Boolean(settings?.smtp);
    if (smtpConfigured) {
      await enqueueEmail(ctx, {
        to: args.email,
        template: "invite",
        payload: { name: args.name, inviteUrl: args.inviteUrl },
      });
    }

    await recordAudit(ctx, {
      actorId,
      action: "user.invite",
      targetId: userId,
      detail: { email: args.email },
    });
    return smtpConfigured;
  },
});

// ── Deactivation (§6.4) ──────────────────────────────────────────────────────

export const deactivate = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.usersManage);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new AppError("not_found");

    // Never strip the last full-permission member (§5.1).
    await assertNotLastAdminRemoval(ctx, args.userId, false);

    await ctx.db.patch(args.userId, { status: "inactive" });

    // Auto-cancel their pending claims (as the claimant) as admin cancellations
    // (§6.4, C-17); their held items surface via admin.recoveryQueue (a query over
    // inactive custodians). Status flip already blocks login.
    const theirClaims = await ctx.db
      .query("claims")
      .withIndex("by_claimant", (q) => q.eq("claimantId", args.userId))
      .collect();
    for (const claim of theirClaims) {
      if (!["pending", "giver_confirmed", "receiver_confirmed"].includes(claim.state)) continue;
      const item = await ctx.db.get(claim.itemId);
      if (!item) continue;
      await ctx.db.patch(claim._id, { state: "cancelled" });
      if (item.state === "claimed") await ctx.db.patch(item._id, { state: "available" });
      await appendLedger(ctx, (await ctx.db.get(item._id))!, {
        type: "claim_cancelled",
        actorId: actor._id,
        claimId: claim._id,
        reason: "admin",
        note: "claimant deactivated",
      });
    }

    await recordAudit(ctx, {
      actorId: actor._id,
      action: "user.deactivate",
      targetId: args.userId,
      detail: { email: target.email },
    });
  },
});

/** Administrative custody correction, e.g. recovering an inactive member's item
 *  (§6.4, §22.2). Records an admin_transfer ledger entry. */
export const adminTransfer = mutation({
  args: { itemId: v.id("items"), newCustodianId: v.id("users"), note: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const perms = await getEffectivePermissions(ctx, actor._id);
    if (!perms.has(PERMISSIONS.itemsEditAny) || !perms.has(PERMISSIONS.claimsManageAny)) {
      throw new AppError("forbidden");
    }
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new AppError("not_found");
    if (item.state === "retired" || item.state === "claimed") throw new AppError("state_conflict");
    const newCustodian = await ctx.db.get(args.newCustodianId);
    if (!newCustodian) throw new AppError("not_found");

    await ctx.db.patch(item._id, { custodianId: args.newCustodianId, atBranchId: undefined });
    await appendLedger(ctx, (await ctx.db.get(item._id))!, {
      type: "admin_transfer",
      actorId: actor._id,
      counterpartyId: args.newCustodianId,
      note: args.note,
    });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "item.admin_transfer",
      targetId: item._id,
      detail: { newCustodianId: args.newCustodianId, note: args.note },
    });
  },
});

export const reactivate = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.usersManage);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new AppError("not_found");
    await ctx.db.patch(args.userId, { status: "active" });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "user.reactivate",
      targetId: args.userId,
    });
  },
});
