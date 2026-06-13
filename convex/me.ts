// "My library" queries (spec §16, §22.2 me.*). All scoped to the signed-in user.
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireUser } from "./lib/permissions";

async function toCard(ctx: QueryCtx, item: Doc<"items">) {
  return {
    _id: item._id,
    title: item.title,
    state: item.state,
    conditionRating: item.conditionRating,
    primaryPhotoUrl: await ctx.storage.getUrl(item.primaryPhotoId),
  };
}

/** Items currently in my care (non-retired). */
export const custody = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const items = await ctx.db
      .query("items")
      .withIndex("by_custodian", (q) => q.eq("custodianId", me._id))
      .collect();
    return Promise.all(items.filter((i) => i.state !== "retired").map((i) => toCard(ctx, i)));
  },
});

/** My live claims (the ones with an active checklist). */
export const claims = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const mine = await ctx.db
      .query("claims")
      .withIndex("by_claimant", (q) => q.eq("claimantId", me._id))
      .collect();
    const live = mine.filter((c) =>
      ["pending", "giver_confirmed", "receiver_confirmed"].includes(c.state),
    );
    return Promise.all(
      live.map(async (c) => {
        const item = await ctx.db.get(c.itemId);
        return {
          _id: c._id,
          itemId: c.itemId,
          itemTitle: item?.title ?? "(item)",
          purpose: c.purpose,
          state: c.state,
          giverConfirmed: c.giverConfirmedAt !== undefined,
          receiverConfirmed: c.receiverConfirmedAt !== undefined,
          expiresAt: c.expiresAt,
        };
      }),
    );
  },
});

/** Items I contributed (any state, including retired). */
export const contributions = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const items = await ctx.db
      .query("items")
      .withIndex("by_contributor", (q) => q.eq("contributedBy", me._id))
      .collect();
    return Promise.all(items.map((i) => toCard(ctx, i)));
  },
});

/** Items I'm watching (populated once watching ships in Phase 3). */
export const watches = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const rows = await ctx.db
      .query("watches")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const items = await Promise.all(rows.map((w) => ctx.db.get(w.itemId)));
    return Promise.all(
      items.filter((i): i is Doc<"items"> => i !== null).map((i) => toCard(ctx, i)),
    );
  },
});
