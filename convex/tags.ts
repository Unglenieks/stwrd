// Tag governance (spec §7.7, §15, §22.2 tags.*).
//
// Tags are free-form strings on items, normalized on write (trimmed, lowercased,
// ≤ 32 chars, ≤ 10/item). Holders of `categories.manage` curate the namespace
// with batch rename/merge across all items.
import {
  AppError,
  PERMISSIONS,
  TAGS_MAX_PER_ITEM,
  zTag,
} from "@lot/shared";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/instance";
import { requirePermission } from "./lib/permissions";
import { buildSearchText } from "./lib/search";

function normalizeTag(raw: string): string {
  const parsed = zTag.safeParse(raw);
  if (!parsed.success) throw new AppError("validation_failed", "invalid tag");
  return parsed.data;
}

/** All tags with usage counts, for the admin tag manager (§15). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.categoriesManage);
    const items = await ctx.db.query("items").collect();
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },
});

/**
 * Rewrite `from` → `to` across every item that carries it, de-duplicating and
 * clamping to the per-item tag limit. Returns the number of items touched. Used
 * by both rename and merge (the distinction is intent, not mechanism: a "rename"
 * targets a fresh name, a "merge" folds into an existing one).
 */
async function rewriteTag(ctx: MutationCtx, from: string, to: string): Promise<number> {
  if (from === to) return 0;
  const items = await ctx.db.query("items").collect();
  let touched = 0;
  for (const item of items) {
    if (!item.tags.includes(from)) continue;
    const next: string[] = [];
    for (const tag of item.tags) {
      const mapped = tag === from ? to : tag;
      if (!next.includes(mapped)) next.push(mapped);
    }
    const tags = next.slice(0, TAGS_MAX_PER_ITEM);
    await ctx.db.patch(item._id, {
      tags,
      searchText: buildSearchText({ title: item.title, description: item.description, tags }),
    });
    touched += 1;
  }
  return touched;
}

export const rename = mutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.categoriesManage);
    const from = normalizeTag(args.from);
    const to = normalizeTag(args.to);
    const touched = await rewriteTag(ctx, from, to);
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "tag.rename",
      detail: { from, to, touched },
    });
    return { touched };
  },
});

export const merge = mutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.categoriesManage);
    const from = normalizeTag(args.from);
    const to = normalizeTag(args.to);
    const touched = await rewriteTag(ctx, from, to);
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "tag.merge",
      detail: { from, to, touched },
    });
    return { touched };
  },
});
