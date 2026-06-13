// Items: contribution + custodian-side mutations (spec §8, §22.2, §22.3).
//
// Photo-accepting writes (contribute, statusUpdate) are ACTIONS: §18.1 mandates
// server-side EXIF verification, which needs blob I/O, so they verify photos then
// delegate to an internal mutation that does the item + ledger writes atomically.
// Metadata-only writes (update, markAvailable, withdrawListing) are plain
// mutations. (Deviation from the §22.2 "M" labels for the two photo writers,
// forced by the verification requirement — documented in the devlog.)
import { v } from "convex/values";
import {
  AppError,
  itemsContributeInput,
  itemsStatusUpdateInput,
  itemsUpdateInput,
  PERMISSIONS,
} from "@lot/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { appendLedger, getItemOrThrow } from "./lib/ledger";
import { getEffectivePermissions, requirePermission, requireUser } from "./lib/permissions";
import { buildSearchText } from "./lib/search";
import { verifyPhotos } from "./storage";

const exchangeMode = v.union(v.literal("reveal_contact"), v.literal("branch"));
const attributesV = v.array(v.object({ key: v.string(), value: v.string() }));
const itemStateV = v.union(
  v.literal("available"),
  v.literal("claimed"),
  v.literal("in_custody"),
  v.literal("under_repair"),
  v.literal("retired"),
);

const LIVE_CLAIM_STATES = ["pending", "giver_confirmed", "receiver_confirmed"];

// ── Contribution (§8.2) ──────────────────────────────────────────────────────

export const contribute = action({
  args: {
    title: v.string(),
    description: v.string(),
    categoryId: v.id("categories"),
    tags: v.array(v.string()),
    attributes: attributesV,
    condition: v.number(),
    photoIds: v.array(v.id("_storage")),
    exchangeMode,
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args): Promise<Id<"items">> => {
    if (!(await getAuthUserId(ctx))) throw new AppError("unauthenticated");
    // Normalize + validate the shape with the shared schema (tags lowercased,
    // limits enforced). Throws validation_failed on bad input.
    const parsed = itemsContributeInput.safeParse(args);
    if (!parsed.success) throw new AppError("validation_failed", parsed.error.message);

    await verifyPhotos(ctx, args.photoIds); // EXIF/size/MIME (§18.1) — C-19

    return ctx.runMutation(internal.items.createContributed, {
      ...parsed.data,
      categoryId: args.categoryId,
      photoIds: args.photoIds,
      branchId: args.branchId,
    });
  },
});

export const createContributed = internalMutation({
  args: {
    title: v.string(),
    description: v.string(),
    categoryId: v.id("categories"),
    tags: v.array(v.string()),
    attributes: attributesV,
    condition: v.number(),
    photoIds: v.array(v.id("_storage")),
    exchangeMode,
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args): Promise<Id<"items">> => {
    const actor = await requirePermission(ctx, PERMISSIONS.itemsContribute);
    if (args.photoIds.length < 1) throw new AppError("validation_failed", "≥1 photo required");
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new AppError("validation_failed", "unknown category");

    const now = Date.now();
    const itemId = await ctx.db.insert("items", {
      title: args.title,
      description: args.description,
      categoryId: args.categoryId,
      tags: args.tags,
      attributes: args.attributes,
      state: "available",
      custodianId: actor._id,
      conditionRating: args.condition,
      primaryPhotoId: args.photoIds[0]!,
      ledgerSeq: 0,
      exchangePref: args.exchangeMode,
      contributedBy: actor._id,
      contributedAt: now,
      lastAvailableAt: now,
      searchText: buildSearchText({
        title: args.title,
        description: args.description,
        tags: args.tags,
      }),
    });

    const item = await getItemOrThrow(ctx, itemId);
    await appendLedger(ctx, item, {
      type: "contributed",
      actorId: actor._id,
      conditionRating: args.condition,
      photoFileIds: args.photoIds,
      branchId: args.branchId,
    });
    return itemId;
  },
});

// ── Status update (§22.2) ────────────────────────────────────────────────────

export const statusUpdate = action({
  args: { itemId: v.id("items"), note: v.string(), photoIds: v.optional(v.array(v.id("_storage"))) },
  handler: async (ctx, args): Promise<void> => {
    if (!(await getAuthUserId(ctx))) throw new AppError("unauthenticated");
    const parsed = itemsStatusUpdateInput.safeParse(args);
    if (!parsed.success) throw new AppError("validation_failed", parsed.error.message);
    if (args.photoIds && args.photoIds.length > 0) await verifyPhotos(ctx, args.photoIds);
    await ctx.runMutation(internal.items.applyStatusUpdate, {
      itemId: args.itemId,
      note: parsed.data.note,
      photoIds: args.photoIds ?? [],
    });
  },
});

export const applyStatusUpdate = internalMutation({
  args: { itemId: v.id("items"), note: v.string(), photoIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const item = await getItemOrThrow(ctx, args.itemId);
    const user = await requireUser(ctx);
    // Custodian-only; allowed in every non-retired state (§22.3).
    if (item.custodianId !== user._id) throw new AppError("forbidden");
    if (item.state === "retired") throw new AppError("state_conflict");
    await appendLedger(ctx, item, {
      type: "status_update",
      actorId: user._id,
      note: args.note,
      photoFileIds: args.photoIds,
    });
  },
});

// ── Metadata edit (§22.2, §22.4: condition is NOT editable here) ─────────────

export const update = mutation({
  args: {
    itemId: v.id("items"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      categoryId: v.optional(v.id("categories")),
      tags: v.optional(v.array(v.string())),
      attributes: v.optional(attributesV),
    }),
  },
  handler: async (ctx, args) => {
    const parsed = itemsUpdateInput.safeParse(args);
    if (!parsed.success) throw new AppError("validation_failed", parsed.error.message);
    const item = await getItemOrThrow(ctx, args.itemId);
    if (item.state === "retired") throw new AppError("state_conflict");

    const user = await requireUser(ctx);
    const perms = await getEffectivePermissions(ctx, user._id);
    const isCustodian = item.custodianId === user._id;
    const canEdit =
      perms.has(PERMISSIONS.itemsEditAny) ||
      (isCustodian && perms.has(PERMISSIONS.itemsUpdateOwn));
    if (!canEdit) throw new AppError("forbidden");

    if (args.patch.categoryId) {
      const category = await ctx.db.get(args.patch.categoryId);
      if (!category) throw new AppError("validation_failed", "unknown category");
    }
    // Metadata only — no ledger entry, condition untouched (§22.4). Built from
    // the Convex-validated args (keeps branded Ids) with tags normalized by zod.
    const patch: Partial<Doc<"items">> = {};
    if (args.patch.title !== undefined) patch.title = args.patch.title;
    if (args.patch.description !== undefined) patch.description = args.patch.description;
    if (args.patch.categoryId !== undefined) patch.categoryId = args.patch.categoryId;
    if (args.patch.tags !== undefined) patch.tags = parsed.data.patch.tags;
    if (args.patch.attributes !== undefined) patch.attributes = args.patch.attributes;
    // Keep the denormalized search text in sync when its inputs change (§17).
    if (
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.tags !== undefined
    ) {
      patch.searchText = buildSearchText({
        title: patch.title ?? item.title,
        description: patch.description ?? item.description,
        tags: patch.tags ?? item.tags,
      });
    }
    await ctx.db.patch(item._id, patch);
  },
});

// ── Listing controls (§22.2, §22.3) ──────────────────────────────────────────

export const markAvailable = mutation({
  args: { itemId: v.id("items"), exchangeMode, branchId: v.optional(v.id("branches")) },
  handler: async (ctx, args) => {
    const item = await getItemOrThrow(ctx, args.itemId);
    const user = await requireUser(ctx);
    if (item.custodianId !== user._id) throw new AppError("forbidden");
    if (item.state !== "in_custody") throw new AppError("state_conflict");
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.status !== "active") throw new AppError("validation_failed", "branch");
    }
    const now = Date.now();
    await ctx.db.patch(item._id, {
      state: "available",
      exchangePref: args.exchangeMode,
      lastAvailableAt: now,
    });
    const fresh = await getItemOrThrow(ctx, args.itemId);
    await appendLedger(ctx, fresh, {
      type: "marked_available",
      actorId: user._id,
      branchId: args.branchId,
    });
  },
});

export const withdrawListing = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await getItemOrThrow(ctx, args.itemId);
    const user = await requireUser(ctx);
    if (item.custodianId !== user._id) throw new AppError("forbidden");
    if (item.state !== "available") throw new AppError("state_conflict");
    const liveClaim = await ctx.db
      .query("claims")
      .withIndex("by_item_state", (q) => q.eq("itemId", item._id).eq("state", "pending"))
      .first();
    if (liveClaim) throw new AppError("state_conflict", "live claim");
    await ctx.db.patch(item._id, { state: "in_custody" });
    const fresh = await getItemOrThrow(ctx, args.itemId);
    await appendLedger(ctx, fresh, {
      type: "status_update",
      actorId: user._id,
      note: "listing withdrawn",
    });
  },
});

// ── Catalog & item reads (§17, §22.2) ────────────────────────────────────────

/**
 * Paginated catalog (§17). With a search term, uses the full-text index over
 * title+description+tags (with index-supported eq filters); otherwise browses by
 * most-recently-available first. Filters the search index can't express
 * (condition range, tag-contains, RETIRED exclusion) are applied to each page —
 * pages may therefore be slightly shorter than the requested size.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    tags: v.optional(v.array(v.string())),
    state: v.optional(itemStateV),
    conditionMin: v.optional(v.number()),
    conditionMax: v.optional(v.number()),
    atBranchId: v.optional(v.id("branches")),
    includeRetired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const includeRetired = args.includeRetired ?? false;
    const wantTags = (args.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const term = args.search?.trim();

    const result = term
      ? await ctx.db
          .query("items")
          .withSearchIndex("search_catalog", (s) => {
            let sq = s.search("searchText", term);
            if (args.state) sq = sq.eq("state", args.state);
            if (args.categoryId) sq = sq.eq("categoryId", args.categoryId);
            if (args.atBranchId) sq = sq.eq("atBranchId", args.atBranchId);
            return sq;
          })
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("items")
          .withIndex("by_lastAvailableAt")
          .order("desc")
          .filter((f) => {
            const conds = [];
            if (args.state) conds.push(f.eq(f.field("state"), args.state));
            else if (!includeRetired) conds.push(f.neq(f.field("state"), "retired"));
            if (args.categoryId) conds.push(f.eq(f.field("categoryId"), args.categoryId));
            if (args.atBranchId) conds.push(f.eq(f.field("atBranchId"), args.atBranchId));
            if (args.conditionMin !== undefined)
              conds.push(f.gte(f.field("conditionRating"), args.conditionMin));
            if (args.conditionMax !== undefined)
              conds.push(f.lte(f.field("conditionRating"), args.conditionMax));
            return conds.length ? conds.reduce((a, b) => f.and(a, b)) : f.eq(f.field("_id"), f.field("_id"));
          })
          .paginate(args.paginationOpts);

    let items = result.page;
    if (term) {
      items = items.filter((it) => {
        if (!includeRetired && !args.state && it.state === "retired") return false;
        if (args.conditionMin !== undefined && it.conditionRating < args.conditionMin) return false;
        if (args.conditionMax !== undefined && it.conditionRating > args.conditionMax) return false;
        return true;
      });
    }
    if (wantTags.length) {
      items = items.filter((it) => wantTags.every((t) => it.tags.includes(t)));
    }

    const page = await Promise.all(
      items.map(async (it) => ({
        _id: it._id,
        title: it.title,
        state: it.state,
        conditionRating: it.conditionRating,
        tags: it.tags,
        atBranchId: it.atBranchId ?? null,
        lastAvailableAt: it.lastAvailableAt,
        primaryPhotoUrl: await ctx.storage.getUrl(it.primaryPhotoId),
      })),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Full item detail for the item page (§16). */
export const get = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const me = await requireUser(ctx);
    const item = await ctx.db.get(itemId);
    if (!item) throw new AppError("not_found");
    const custodian = await ctx.db.get(item.custodianId);
    const category = await ctx.db.get(item.categoryId);
    const branch = item.atBranchId ? await ctx.db.get(item.atBranchId) : null;
    const watching = await ctx.db
      .query("watches")
      .withIndex("by_user_item", (q) => q.eq("userId", me._id).eq("itemId", itemId))
      .first();
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_item", (q) => q.eq("itemId", itemId))
      .collect();
    const liveClaim = claims.find((c) => LIVE_CLAIM_STATES.includes(c.state)) ?? null;
    // The live claim id, but only when the viewer is a party to it (claimant or
    // current holder) — drives the claim checklist on the item page (§16).
    const iAmParty =
      liveClaim !== null &&
      (liveClaim.claimantId === me._id || item.custodianId === me._id);

    return {
      _id: item._id,
      title: item.title,
      description: item.description,
      tags: item.tags,
      attributes: item.attributes,
      state: item.state,
      conditionRating: item.conditionRating,
      categoryId: item.categoryId,
      categoryName: category?.name ?? null,
      categoryArchived: category?.archived ?? false,
      custodianId: item.custodianId,
      custodianName: custodian?.name ?? "Unknown",
      atBranchId: item.atBranchId ?? null,
      branchName: branch?.name ?? null,
      exchangePref: item.exchangePref,
      contributedAt: item.contributedAt,
      lastAvailableAt: item.lastAvailableAt,
      primaryPhotoUrl: await ctx.storage.getUrl(item.primaryPhotoId),
      isWatching: watching !== null,
      hasLiveClaim: liveClaim !== null,
      myActiveClaimId: iAmParty ? liveClaim!._id : null,
      isMine: item.custodianId === me._id,
    };
  },
});

/** Paginated ledger timeline, newest first (§16 centerpiece; 50/page §23.1). */
export const ledger = query({
  args: { itemId: v.id("items"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const result = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_item_seq", (q) => q.eq("itemId", args.itemId))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (e) => ({
        _id: e._id,
        seq: e.seq,
        type: e.type,
        note: e.note ?? null,
        reason: e.reason ?? null,
        conditionRating: e.conditionRating ?? null,
        createdAt: e.createdAt,
        actorName: (await ctx.db.get(e.actorId))?.name ?? "Unknown",
        counterpartyName: e.counterpartyId
          ? ((await ctx.db.get(e.counterpartyId))?.name ?? null)
          : null,
        photoUrls: (
          await Promise.all(e.photoFileIds.map((id) => ctx.storage.getUrl(id)))
        ).filter((u): u is string => u !== null),
      })),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
