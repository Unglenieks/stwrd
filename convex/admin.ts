// Admin dashboard queries (spec §15, §22.2). Each is gated by the permission its
// panel requires; a member sees only the panels their permissions allow.
import { paginationOptsValidator } from "convex/server";
import { PERMISSIONS } from "@lot/shared";
import { query } from "./_generated/server";
import { requirePermission } from "./lib/permissions";

const LIVE = ["pending", "giver_confirmed", "receiver_confirmed"];

/** Stuck handoffs (§9.3): past expiry but half-confirmed, so the sweep skipped them. */
export const stuckClaims = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.claimsManageAny);
    const now = Date.now();
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_state_expiresAt", (q) => q.eq("state", "giver_confirmed").lt("expiresAt", now))
      .collect();
    const more = await ctx.db
      .query("claims")
      .withIndex("by_state_expiresAt", (q) => q.eq("state", "receiver_confirmed").lt("expiresAt", now))
      .collect();
    const stuck = [...claims, ...more];
    return Promise.all(
      stuck.map(async (c) => {
        const item = await ctx.db.get(c.itemId);
        const claimant = await ctx.db.get(c.claimantId);
        return {
          _id: c._id,
          itemId: c.itemId,
          itemTitle: item?.title ?? "(item)",
          claimantName: claimant?.name ?? "Member",
          giverConfirmed: c.giverConfirmedAt !== undefined,
          receiverConfirmed: c.receiverConfirmedAt !== undefined,
          expiresAt: c.expiresAt,
        };
      }),
    );
  },
});

/** Live claims board — all non-terminal claims (§15 Claims panel). */
export const liveClaims = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.claimsManageAny);
    const all = (
      await Promise.all(
        LIVE.map((s) =>
          ctx.db.query("claims").withIndex("by_state", (q) => q.eq("state", s as "pending")).collect(),
        ),
      )
    ).flat();
    return Promise.all(
      all.map(async (c) => {
        const item = await ctx.db.get(c.itemId);
        return { _id: c._id, itemId: c.itemId, itemTitle: item?.title ?? "(item)", state: c.state };
      }),
    );
  },
});

/** Items whose custodian is inactive — the deactivation recovery queue (§6.4). */
export const recoveryQueue = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.usersManage);
    const users = await ctx.db.query("users").collect();
    const inactive = new Set(users.filter((u) => u.status === "inactive").map((u) => u._id));
    const result: {
      itemId: string;
      title: string;
      custodianName: string;
      primaryPhotoUrl: string | null;
    }[] = [];
    for (const uid of inactive) {
      const items = await ctx.db
        .query("items")
        .withIndex("by_custodian", (q) => q.eq("custodianId", uid as never))
        .collect();
      for (const it of items) {
        if (it.state === "retired") continue;
        const u = users.find((x) => x._id === uid);
        result.push({
          itemId: it._id,
          title: it.title,
          custodianName: u?.name ?? "Inactive member",
          primaryPhotoUrl: await ctx.storage.getUrl(it.primaryPhotoId),
        });
      }
    }
    return result;
  },
});

/** Unmatched inbound mail (§13). */
export const unmatchedInbound = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.instanceAuditView);
    const rows = await ctx.db
      .query("emailInbound")
      .withIndex("by_claim", (q) => q.eq("matchedClaimId", undefined))
      .order("desc")
      .take(100);
    return rows
      .filter((r) => r.disposition !== "logged")
      .map((r) => ({
        _id: r._id,
        from: r.from,
        subject: r.subject,
        disposition: r.disposition,
        excerpt: r.bodyText.slice(0, 200),
        receivedAt: r.receivedAt,
      }));
  },
});

/** Email delivery log (§15 Audit & email). */
export const emailLog = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requirePermission(ctx, PERMISSIONS.instanceAuditView);
    const result = await ctx.db.query("emailOutbox").order("desc").paginate(paginationOpts);
    return {
      page: result.page.map((m) => ({
        _id: m._id,
        to: m.to,
        template: m.template,
        state: m.state,
        attempts: m.attempts,
        lastError: m.lastError ?? null,
        createdAt: m.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Cross-item audit feed (§15). */
export const auditFeed = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requirePermission(ctx, PERMISSIONS.instanceAuditView);
    const result = await ctx.db
      .query("auditEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(paginationOpts);
    return {
      page: await Promise.all(
        result.page.map(async (e) => ({
          _id: e._id,
          action: e.action,
          actorName: e.actorId ? ((await ctx.db.get(e.actorId))?.name ?? "—") : "system",
          detail: e.detail,
          createdAt: e.createdAt,
        })),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
