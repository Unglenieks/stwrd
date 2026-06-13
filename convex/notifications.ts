// Notification inbox (spec §14, §22.2). The single reactive feed behind the bell
// icon; renderers key off `kind` alone (§23.5).
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUserId, requireUser } from "./lib/permissions";

/** My notifications, newest first (paginated). */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireUser(ctx);
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .order("desc") // newest first (by _creationTime within the user)
      .paginate(paginationOpts);
    return {
      page: result.page.map((n) => ({
        _id: n._id,
        kind: n.kind,
        payload: n.payload,
        read: n.read,
        createdAt: n.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Count of my unread notifications, for the bell badge. */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false))
      .collect();
    return unread.length;
  },
});

/** Mark specific notifications (mine) as read. */
export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, { ids }) => {
    const me = await requireUser(ctx);
    for (const id of ids) {
      const n = await ctx.db.get(id);
      if (n && n.userId === me._id && !n.read) await ctx.db.patch(id, { read: true });
    }
  },
});

/** Mark all of my notifications read. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();
    for (const n of unread) await ctx.db.patch(n._id, { read: true });
  },
});
