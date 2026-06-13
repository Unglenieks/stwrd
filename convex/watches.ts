// Watching (spec §9.5, §22.2). Any member can watch an item; when it next turns
// AVAILABLE every watcher gets a `watched_item_available` notification. Watching
// confers ZERO priority — first confirmed claim still wins (§1.2). Watching your
// own item is allowed (§22.4); the notification is suppressed for the actor.
import { v } from "convex/values";
import { AppError } from "@lot/shared";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/permissions";

/** Toggle a watch on an item for the current member. Returns the new state. */
export const toggle = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }): Promise<{ watching: boolean }> => {
    const me = await requireUser(ctx);
    const item = await ctx.db.get(itemId);
    if (!item) throw new AppError("not_found");

    const existing = await ctx.db
      .query("watches")
      .withIndex("by_user_item", (q) => q.eq("userId", me._id).eq("itemId", itemId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { watching: false };
    }
    await ctx.db.insert("watches", { userId: me._id, itemId, createdAt: Date.now() });
    return { watching: true };
  },
});
