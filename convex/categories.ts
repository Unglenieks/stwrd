// Category tree (spec §7.7, §22.2 categories.*).
//
// A managed tree of depth ≤ 3. Items reference leaf or non-leaf nodes. Archiving
// never blocks (§22.4): items keep their reference; archived nodes just drop out
// of pickers and gain an "(archived)" suffix in displays.
import { v } from "convex/values";
import { AppError, CATEGORY_MAX_DEPTH, PERMISSIONS } from "@stwrd/shared";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/instance";
import { requirePermission, requireUser } from "./lib/permissions";

/** Depth of an existing node (root = 1), walking the parent chain. */
async function nodeDepth(ctx: QueryCtx | MutationCtx, id: Id<"categories">): Promise<number> {
  let depth = 1;
  let cursor: Id<"categories"> | undefined = id;
  // Bounded by the tree being acyclic + the depth invariant; the guard caps any
  // pathological chain.
  for (let i = 0; i < CATEGORY_MAX_DEPTH + 2 && cursor; i++) {
    const node: Doc<"categories"> | null = await ctx.db.get(cursor);
    if (!node || !node.parentId) break;
    depth += 1;
    cursor = node.parentId;
  }
  return depth;
}

/** Height of the subtree rooted at `id` (a leaf has height 1). */
async function subtreeHeight(ctx: QueryCtx | MutationCtx, id: Id<"categories">): Promise<number> {
  const children = await ctx.db
    .query("categories")
    .withIndex("by_parent", (q) => q.eq("parentId", id))
    .collect();
  if (children.length === 0) return 1;
  let max = 0;
  for (const child of children) max = Math.max(max, await subtreeHeight(ctx, child._id));
  return 1 + max;
}

/** Is `candidate` inside the subtree rooted at `nodeId` (or equal to it)? */
async function isInSubtree(
  ctx: QueryCtx | MutationCtx,
  nodeId: Id<"categories">,
  candidate: Id<"categories">,
): Promise<boolean> {
  if (candidate === nodeId) return true;
  let cursor: Id<"categories"> | undefined = candidate;
  for (let i = 0; i < CATEGORY_MAX_DEPTH + 2 && cursor; i++) {
    const node: Doc<"categories"> | null = await ctx.db.get(cursor);
    if (!node) break;
    if (node.parentId === nodeId) return true;
    cursor = node.parentId;
  }
  return false;
}

/**
 * The full category tree for pickers and the admin editor. `includeArchived`
 * surfaces archived nodes (suffixed in the UI); pickers omit them.
 */
export const tree = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    await requireUser(ctx);
    const all = await ctx.db.query("categories").collect();
    const visible = includeArchived ? all : all.filter((c) => !c.archived);
    return visible
      .map((c) => ({
        _id: c._id,
        name: c.name,
        parentId: c.parentId ?? null,
        description: c.description ?? null,
        archived: c.archived,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Create or edit a category node. Enforces depth ≤ 3 and rejects cycles. */
export const upsert = mutation({
  args: {
    categoryId: v.optional(v.id("categories")),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.categoriesManage);
    const name = args.name.trim();
    if (!name) throw new AppError("validation_failed", "name required");

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent) throw new AppError("not_found", "parent category");
    }

    if (args.categoryId) {
      const existing = await ctx.db.get(args.categoryId);
      if (!existing) throw new AppError("not_found");

      // Omitted fields are preserved (this is an edit, not a full replace) — a
      // rename must not silently re-parent the node to root or wipe its
      // description. Re-parenting only happens when parentId is explicitly given.
      const reParenting = args.parentId !== undefined && args.parentId !== existing.parentId;
      const effectiveParentId = args.parentId ?? existing.parentId;
      const newDepth = effectiveParentId ? (await nodeDepth(ctx, effectiveParentId)) + 1 : 1;
      if (newDepth > CATEGORY_MAX_DEPTH) {
        throw new AppError("validation_failed", `category depth exceeds ${CATEGORY_MAX_DEPTH}`);
      }
      if (reParenting && args.parentId) {
        // A node cannot be re-parented under itself or a descendant (cycle).
        if (await isInSubtree(ctx, args.categoryId, args.parentId)) {
          throw new AppError("validation_failed", "cannot move a category under its own subtree");
        }
        // The moved subtree must still fit within the depth limit.
        const height = await subtreeHeight(ctx, args.categoryId);
        if (newDepth + height - 1 > CATEGORY_MAX_DEPTH) {
          throw new AppError("validation_failed", "move would exceed category depth limit");
        }
      }
      await ctx.db.patch(existing._id, {
        name,
        parentId: effectiveParentId,
        description: args.description ?? existing.description,
      });
      await recordAudit(ctx, {
        actorId: actor._id,
        action: "category.update",
        targetId: existing._id,
        detail: { name },
      });
      return existing._id;
    }

    // Create: depth = parent depth + 1 (or 1 for a root).
    const newDepth = args.parentId ? (await nodeDepth(ctx, args.parentId)) + 1 : 1;
    if (newDepth > CATEGORY_MAX_DEPTH) {
      throw new AppError("validation_failed", `category depth exceeds ${CATEGORY_MAX_DEPTH}`);
    }
    const id = await ctx.db.insert("categories", {
      name,
      parentId: args.parentId,
      description: args.description,
      archived: false,
    });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "category.create",
      targetId: id,
      detail: { name },
    });
    return id;
  },
});

/**
 * Archive (or unarchive) a category. Never blocks — items keep their reference
 * (§22.4); the node simply leaves pickers. Archiving a node archives nothing
 * else; children remain independently toggleable.
 */
export const archive = mutation({
  args: { categoryId: v.id("categories"), archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.categoriesManage);
    const existing = await ctx.db.get(args.categoryId);
    if (!existing) throw new AppError("not_found");
    const archived = args.archived ?? true;
    await ctx.db.patch(existing._id, { archived });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: archived ? "category.archive" : "category.unarchive",
      targetId: existing._id,
    });
  },
});
