// Claim & two-party handoff protocol (spec §9, §22.2). The core interaction.
//
// A claim is instant (no holder approval) but provisional until BOTH parties
// confirm the physical exchange — and the receiver's confirmation REQUIRES a
// photo. The handoff_completed ledger entry (which moves custody) is only ever
// written when both have confirmed, and it always carries ≥1 receiver photo
// (C-08). confirmReceiver is an action (photo verification needs blob I/O, §18.1)
// delegating to an internal mutation for the atomic finalize.
import { v } from "convex/values";
import { AppError, CLAIM_EXPIRING_WARN_HOURS, PERMISSIONS } from "@lot/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { claimExpiryMs } from "./lib/instance";
import { appendLedger, getItemOrThrow } from "./lib/ledger";
import { notify } from "./lib/notify";
import { getEffectivePermissions, requirePermission, requireUser } from "./lib/permissions";
import { verifyPhotos } from "./storage";

const TERMINAL = ["completed", "cancelled"];
const LIVE = ["pending", "giver_confirmed", "receiver_confirmed"];

async function liveClaimForItem(
  ctx: MutationCtx,
  itemId: Id<"items">,
): Promise<Doc<"claims"> | null> {
  const claims = await ctx.db
    .query("claims")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .collect();
  return claims.find((c) => LIVE.includes(c.state)) ?? null;
}

// ── Create (§9.1) ────────────────────────────────────────────────────────────

export const create = mutation({
  args: { itemId: v.id("items"), purpose: v.union(v.literal("use"), v.literal("repair")) },
  handler: async (ctx, args): Promise<Id<"claims">> => {
    const user = await requirePermission(ctx, PERMISSIONS.itemsClaim);
    const item = await getItemOrThrow(ctx, args.itemId);
    if (item.state !== "available") throw new AppError("item_not_available");
    if (item.custodianId === user._id) throw new AppError("self_claim_forbidden");
    // Atomic existence check — Convex serializes mutations, so two simultaneous
    // claims resolve to exactly one winner; the loser gets item_not_available (C-07).
    if (await liveClaimForItem(ctx, args.itemId)) throw new AppError("item_not_available");

    const now = Date.now();
    const claimId = await ctx.db.insert("claims", {
      itemId: args.itemId,
      claimantId: user._id,
      purpose: args.purpose,
      staging: false,
      state: "pending",
      exchangeMode: item.exchangePref,
      contactRevealed: item.exchangePref === "reveal_contact",
      receiverPhotoIds: [],
      expiresAt: now + (await claimExpiryMs(ctx)),
      createdAt: now,
    });
    await ctx.db.patch(item._id, { state: "claimed" });
    await appendLedger(ctx, await getItemOrThrow(ctx, args.itemId), {
      type: "claimed",
      actorId: user._id,
      claimId,
    });
    await notify(ctx, item.custodianId, "claim_placed", {
      claimId,
      itemId: item._id,
      itemTitle: item.title,
      otherPartyName: user.name ?? "A member",
    });
    return claimId;
  },
});

// ── Two-party confirmation (§9.2) ────────────────────────────────────────────

export const confirmGiver = mutation({
  args: { claimId: v.id("claims") },
  handler: async (ctx, { claimId }) => {
    const user = await requireUser(ctx);
    const claim = await ctx.db.get(claimId);
    if (!claim) throw new AppError("not_found");
    if (TERMINAL.includes(claim.state)) throw new AppError("claim_not_pending");
    const item = await getItemOrThrow(ctx, claim.itemId);
    // The giver is the item's current custodian.
    if (item.custodianId !== user._id) throw new AppError("claim_wrong_party");
    if (claim.giverConfirmedAt) return; // idempotent

    await ctx.db.patch(claimId, {
      giverConfirmedAt: Date.now(),
      state: claim.receiverConfirmedAt ? "receiver_confirmed" : "giver_confirmed",
    });
    if (claim.receiverConfirmedAt) {
      await finalizeHandoff(ctx, claimId);
    } else {
      await notify(ctx, claim.claimantId, "handoff_confirmed_by_other", {
        claimId,
        itemId: item._id,
        itemTitle: item.title,
        otherPartyName: user.name ?? "The holder",
      });
    }
  },
});

export const confirmReceiver = action({
  args: { claimId: v.id("claims"), photoIds: v.array(v.id("_storage")), condition: v.number() },
  handler: async (ctx, args): Promise<void> => {
    if (!(await getAuthUserId(ctx))) throw new AppError("unauthenticated");
    if (args.photoIds.length < 1) throw new AppError("photo_required");
    await verifyPhotos(ctx, args.photoIds); // EXIF/size/MIME (§18.1)
    await ctx.runMutation(internal.claims.applyReceiverConfirm, args);
  },
});

export const applyReceiverConfirm = internalMutation({
  args: { claimId: v.id("claims"), photoIds: v.array(v.id("_storage")), condition: v.number() },
  handler: async (ctx, args) => {
    if (args.photoIds.length < 1) throw new AppError("photo_required");
    const user = await requireUser(ctx);
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new AppError("not_found");
    if (TERMINAL.includes(claim.state)) throw new AppError("claim_not_pending");
    if (claim.claimantId !== user._id) throw new AppError("claim_wrong_party");

    await ctx.db.patch(args.claimId, {
      receiverConfirmedAt: Date.now(),
      receiverPhotoIds: args.photoIds,
      receiverCondition: args.condition,
      state: claim.giverConfirmedAt ? "giver_confirmed" : "receiver_confirmed",
    });
    if (claim.giverConfirmedAt) await finalizeHandoff(ctx, args.claimId);
  },
});

/**
 * Both parties confirmed → move custody to the receiver and write the
 * handoff_completed entry embedding the receiver's photos + rating (the
 * receiver's condition becomes authoritative, §20.3). Re-reads fresh docs.
 */
async function finalizeHandoff(ctx: MutationCtx, claimId: Id<"claims">): Promise<void> {
  const claim = await ctx.db.get(claimId);
  if (!claim) throw new AppError("not_found");
  const item = await getItemOrThrow(ctx, claim.itemId);
  const giverId = item.custodianId;
  const receiverId = claim.claimantId;
  if (!claim.receiverPhotoIds.length) throw new AppError("photo_required"); // invariant guard (C-08)

  await ctx.db.patch(item._id, {
    custodianId: receiverId,
    state: claim.purpose === "repair" ? "under_repair" : "in_custody",
    conditionRating: claim.receiverCondition ?? item.conditionRating,
    atBranchId: undefined,
  });
  await ctx.db.patch(claimId, { state: "completed" });
  await appendLedger(ctx, await getItemOrThrow(ctx, item._id), {
    type: "handoff_completed",
    actorId: receiverId,
    counterpartyId: giverId,
    claimId,
    conditionRating: claim.receiverCondition,
    photoFileIds: claim.receiverPhotoIds,
  });
  for (const uid of [giverId, receiverId]) {
    await notify(ctx, uid, "handoff_completed", {
      claimId,
      itemId: item._id,
      itemTitle: item.title,
    });
  }
}

// ── Cancellation (§9.3) ──────────────────────────────────────────────────────

export const cancel = mutation({
  args: { claimId: v.id("claims"), note: v.optional(v.string()) },
  handler: async (ctx, { claimId, note }) => {
    const user = await requireUser(ctx);
    const claim = await ctx.db.get(claimId);
    if (!claim) throw new AppError("not_found");
    if (TERMINAL.includes(claim.state)) throw new AppError("claim_not_pending");
    const item = await getItemOrThrow(ctx, claim.itemId);

    const perms = await getEffectivePermissions(ctx, user._id);
    let reason: "by_claimant" | "by_holder" | "admin";
    if (claim.claimantId === user._id) reason = "by_claimant";
    else if (item.custodianId === user._id) reason = "by_holder";
    else if (perms.has(PERMISSIONS.claimsManageAny)) reason = "admin";
    else throw new AppError("forbidden");

    await ctx.db.patch(claimId, { state: "cancelled" });
    await ctx.db.patch(item._id, { state: "available" });
    await appendLedger(ctx, await getItemOrThrow(ctx, item._id), {
      type: "claim_cancelled",
      actorId: user._id,
      claimId,
      reason,
      note,
    });
    // Notify the other party (whoever didn't cancel).
    const other = user._id === claim.claimantId ? item.custodianId : claim.claimantId;
    await notify(ctx, other, "claim_cancelled", {
      claimId,
      itemId: item._id,
      itemTitle: item.title,
      reason,
    });
  },
});

// ── Expiry sweep & expiring notifier (cron-driven, §9.3, §23.2) ──────────────

/**
 * Auto-expire claims past `expiresAt` that NO party has confirmed (C-09). A claim
 * with either confirmation is SKIPPED (§9.3) — a half-done branch drop shouldn't
 * auto-revert; it surfaces in the admin stuck-handoffs queue (Phase 4) instead
 * (C-10). Runs every 15 min.
 */
export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("claims")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();
    for (const claim of due) {
      if (claim.state !== "pending") continue;
      if (claim.giverConfirmedAt || claim.receiverConfirmedAt) continue; // skip half-done (C-10)
      const item = await ctx.db.get(claim.itemId);
      if (!item) continue;
      await ctx.db.patch(claim._id, { state: "cancelled" });
      if (item.state === "claimed") await ctx.db.patch(item._id, { state: "available" });
      // No human actor on auto-expiry; attribute to the holder (whose item
      // reverts), with reason `expired` making the automated origin unambiguous.
      await appendLedger(ctx, (await ctx.db.get(item._id))!, {
        type: "claim_cancelled",
        actorId: item.custodianId,
        claimId: claim._id,
        reason: "expired",
      });
      for (const uid of [claim.claimantId, item.custodianId]) {
        await notify(ctx, uid, "claim_cancelled", {
          claimId: claim._id,
          itemId: item._id,
          itemTitle: item.title,
          reason: "expired",
        });
      }
    }
  },
});

/** Send the once-per-claim "expiring in ≤24h" warning (C-09). Runs hourly. */
export const notifyExpiring = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const horizon = now + CLAIM_EXPIRING_WARN_HOURS * 60 * 60 * 1000;
    const soon = await ctx.db
      .query("claims")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", horizon))
      .collect();
    for (const claim of soon) {
      if (claim.state !== "pending") continue;
      if (claim.giverConfirmedAt || claim.receiverConfirmedAt) continue;
      if (claim.expiresAt <= now) continue; // already expired → the sweep handles it
      if (claim.expiringNotifiedAt) continue; // once per claim
      const item = await ctx.db.get(claim.itemId);
      if (!item) continue;
      const hoursLeft = Math.max(1, Math.ceil((claim.expiresAt - now) / (60 * 60 * 1000)));
      await notify(ctx, claim.claimantId, "claim_expiring", {
        claimId: claim._id,
        itemId: item._id,
        itemTitle: item.title,
        hoursLeft,
      });
      await ctx.db.patch(claim._id, { expiringNotifiedAt: now });
    }
  },
});

// ── Live claim screen (§9.2, §16) ────────────────────────────────────────────

export const get = query({
  args: { claimId: v.id("claims") },
  handler: async (ctx, { claimId }) => {
    const me = await requireUser(ctx);
    const claim = await ctx.db.get(claimId);
    if (!claim) throw new AppError("not_found");
    const item = await ctx.db.get(claim.itemId);
    if (!item) throw new AppError("not_found");

    const isReceiver = claim.claimantId === me._id;
    const isGiver = item.custodianId === me._id && !isReceiver;
    if (!isReceiver && !isGiver) {
      const perms = await getEffectivePermissions(ctx, me._id);
      if (!perms.has(PERMISSIONS.claimsManageAny)) throw new AppError("forbidden");
    }

    const claimant = await ctx.db.get(claim.claimantId);
    const giver = await ctx.db.get(item.custodianId);
    const reveal = claim.exchangeMode === "reveal_contact";
    const otherUser = isReceiver ? giver : claimant;
    const otherContact =
      reveal && otherUser
        ? {
            name: otherUser.name ?? "Member",
            email: otherUser.email ?? null,
            phone: otherUser.contactPhone ?? null,
          }
        : null;

    return {
      _id: claim._id,
      itemId: item._id,
      itemTitle: item.title,
      state: claim.state,
      purpose: claim.purpose,
      exchangeMode: claim.exchangeMode,
      myRole: (isReceiver ? "receiver" : isGiver ? "giver" : "admin") as
        | "receiver"
        | "giver"
        | "admin",
      giverConfirmed: claim.giverConfirmedAt !== undefined,
      receiverConfirmed: claim.receiverConfirmedAt !== undefined,
      giverName: giver?.name ?? "Holder",
      claimantName: claimant?.name ?? "Member",
      otherContact,
      expiresAt: claim.expiresAt,
    };
  },
});
