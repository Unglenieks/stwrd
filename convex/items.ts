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
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation } from "./_generated/server";
import { appendLedger, getItemOrThrow } from "./lib/ledger";
import { getEffectivePermissions, requirePermission, requireUser } from "./lib/permissions";
import { verifyPhotos } from "./storage";

const exchangeMode = v.union(v.literal("reveal_contact"), v.literal("branch"));
const attributesV = v.array(v.object({ key: v.string(), value: v.string() }));

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
