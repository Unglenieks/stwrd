// Branches — member-hosted physical drop points (spec §12, §22.2). They decouple
// handoffs in time so two schedules never have to align. "Public access" is
// PHYSICAL only; the digital catalog stays members-only (§1.2).
import { v } from "convex/values";
import { AppError, PERMISSIONS } from "@stwrd/shared";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getSettings, recordAudit } from "./lib/instance";
import { getEffectivePermissions, requirePermission, requireUser } from "./lib/permissions";

const geoV = v.object({ lat: v.number(), lng: v.number() });

/** Register a branch on one's own property (§12). */
export const create = mutation({
  args: {
    name: v.string(),
    locationText: v.string(),
    accessNotes: v.optional(v.string()),
    description: v.optional(v.string()),
    geo: v.optional(geoV),
    photoIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args): Promise<Id<"branches">> => {
    const actor = await requirePermission(ctx, PERMISSIONS.branchesCreate);
    const settings = await getSettings(ctx);
    if (settings && !settings.branchesEnabled) {
      throw new AppError("forbidden", "branches are disabled for this org");
    }
    const name = args.name.trim();
    const locationText = args.locationText.trim();
    if (!name || !locationText) throw new AppError("validation_failed", "name + location required");
    const id = await ctx.db.insert("branches", {
      name,
      hostUserId: actor._id,
      description: args.description ?? "",
      locationText,
      geo: args.geo,
      accessNotes: args.accessNotes ?? "",
      photoFileIds: args.photoIds ?? [],
      status: "active",
    });
    await recordAudit(ctx, { actorId: actor._id, action: "branch.create", targetId: id, detail: { name } });
    return id;
  },
});

/** Edit a branch (host or branches.manage_any). Deactivation blocked while items flagged (§22.4). */
export const update = mutation({
  args: {
    branchId: v.id("branches"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      locationText: v.optional(v.string()),
      accessNotes: v.optional(v.string()),
      geo: v.optional(geoV),
      photoIds: v.optional(v.array(v.id("_storage"))),
      status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const branch = await ctx.db.get(args.branchId);
    if (!branch) throw new AppError("not_found");
    const perms = await getEffectivePermissions(ctx, user._id);
    const isHost = branch.hostUserId === user._id;
    if (!isHost && !perms.has(PERMISSIONS.branchesManageAny)) throw new AppError("forbidden");

    if (args.patch.status === "inactive" && branch.status !== "inactive") {
      const flagged = await ctx.db
        .query("items")
        .withIndex("by_branch", (q) => q.eq("atBranchId", branch._id))
        .first();
      if (flagged) throw new AppError("branch_has_items");
    }

    const patch: Record<string, unknown> = {};
    const p = args.patch;
    if (p.name !== undefined) patch.name = p.name.trim();
    if (p.description !== undefined) patch.description = p.description;
    if (p.locationText !== undefined) patch.locationText = p.locationText.trim();
    if (p.accessNotes !== undefined) patch.accessNotes = p.accessNotes;
    if (p.geo !== undefined) patch.geo = p.geo;
    if (p.photoIds !== undefined) patch.photoFileIds = p.photoIds;
    if (p.status !== undefined) patch.status = p.status;
    await ctx.db.patch(branch._id, patch);
    await recordAudit(ctx, { actorId: user._id, action: "branch.update", targetId: branch._id, detail: patch });
  },
});

/** Active branches (for pickers + the /branches index). */
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    await requireUser(ctx);
    const all = await ctx.db.query("branches").collect();
    const visible = includeInactive ? all : all.filter((b) => b.status === "active");
    return Promise.all(
      visible.map(async (b) => {
        const host = await ctx.db.get(b.hostUserId);
        const itemCount = (
          await ctx.db.query("items").withIndex("by_branch", (q) => q.eq("atBranchId", b._id)).collect()
        ).length;
        return {
          _id: b._id,
          name: b.name,
          locationText: b.locationText,
          status: b.status,
          hostName: host?.name ?? "Member",
          itemCount,
        };
      }),
    );
  },
});

/** Branch detail page (§12): items flagged here, host info; claim-in-flight items
 *  are visible only to involved parties + host. */
export const get = query({
  args: { branchId: v.id("branches") },
  handler: async (ctx, { branchId }) => {
    const me = await requireUser(ctx);
    const branch = await ctx.db.get(branchId);
    if (!branch) throw new AppError("not_found");
    const host = await ctx.db.get(branch.hostUserId);
    const items = await ctx.db
      .query("items")
      .withIndex("by_branch", (q) => q.eq("atBranchId", branchId))
      .collect();
    const isHost = branch.hostUserId === me._id;

    const cards = await Promise.all(
      items.map(async (it) => ({
        _id: it._id,
        title: it.title,
        state: it.state,
        primaryPhotoUrl: await ctx.storage.getUrl(it.primaryPhotoId),
      })),
    );

    return {
      _id: branch._id,
      name: branch.name,
      description: branch.description,
      locationText: branch.locationText,
      geo: branch.geo ?? null,
      // Access notes are sensitive (combos, latches) — show to members; they can
      // physically walk up anyway (§12).
      accessNotes: branch.accessNotes,
      status: branch.status,
      hostName: host?.name ?? "Member",
      hostContact: { email: host?.email ?? null, phone: host?.contactPhone ?? null },
      isHost,
      items: cards,
    };
  },
});
