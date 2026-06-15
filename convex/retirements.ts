// Retirement decisions (spec §11, §22.2). Approving retires the item terminally;
// the record (ledger) remains forever — the org's provenance memory. The proposer
// cannot approve their own proposal unless they are the org's only approver
// (small-org escape hatch, flagged in the audit feed).
import { v } from "convex/values";
import { AppError, PERMISSIONS } from "@stwrd/shared";
import type { Id } from "./_generated/dataModel";
import { mutation, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/instance";
import { appendLedger, getItemOrThrow } from "./lib/ledger";
import { notify } from "./lib/notify";
import { getEffectivePermissions, requirePermission } from "./lib/permissions";

/** Count active members who currently hold a permission. */
async function countMembersWithPermission(ctx: QueryCtx, perm: string): Promise<number> {
  const roles = await ctx.db.query("roles").collect();
  const roleIds = roles.filter((r) => r.permissions.includes(perm)).map((r) => r._id);
  const members = new Set<string>();
  for (const roleId of roleIds) {
    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();
    for (const a of assignments) {
      const u = await ctx.db.get(a.userId);
      if (u && u.status !== "inactive") members.add(a.userId);
    }
  }
  return members.size;
}

/** The actor of the outstanding retirement proposal, or null if none is open. */
async function openProposalProposer(
  ctx: QueryCtx,
  itemId: Id<"items">,
): Promise<Id<"users"> | null> {
  // Walk the ledger newest-first; the first retirement-lifecycle entry decides.
  const recent = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_item_seq", (q) => q.eq("itemId", itemId))
    .order("desc")
    .take(50);
  for (const e of recent) {
    if (e.type === "retirement_proposed") return e.actorId;
    if (e.type === "retired" || e.type === "retirement_denied") return null;
  }
  return null;
}

export const decide = mutation({
  args: { itemId: v.id("items"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const decider = await requirePermission(ctx, PERMISSIONS.itemsRetireApprove);
    const item = await getItemOrThrow(ctx, args.itemId);
    if (item.state === "retired") throw new AppError("state_conflict");

    // Blocked during a live claim (§22.4) — a fixer mid-claim argues against it.
    const live = await ctx.db
      .query("claims")
      .withIndex("by_item_state", (q) => q.eq("itemId", item._id).eq("state", "pending"))
      .first();
    if (live) throw new AppError("state_conflict", "live claim");

    const proposer = await openProposalProposer(ctx, item._id);
    if (!proposer) throw new AppError("state_conflict", "no open retirement proposal");

    // Proposer ≠ decider, unless they're the sole approver in the org (audited).
    let soleApprover = false;
    if (proposer === decider._id) {
      const approvers = await countMembersWithPermission(ctx, PERMISSIONS.itemsRetireApprove);
      if (approvers > 1) throw new AppError("forbidden", "proposer cannot approve own proposal");
      soleApprover = true;
    }

    if (args.approve) {
      await ctx.db.patch(item._id, { state: "retired", retiredAt: Date.now() });
      await appendLedger(ctx, await getItemOrThrow(ctx, item._id), {
        type: "retired",
        actorId: decider._id,
        note: args.note,
      });
    } else {
      await appendLedger(ctx, item, {
        type: "retirement_denied",
        actorId: decider._id,
        note: args.note,
      });
    }

    await recordAudit(ctx, {
      actorId: decider._id,
      action: args.approve ? "retirement.approve" : "retirement.deny",
      targetId: item._id,
      detail: { proposer, soleApprover },
    });
    await notify(ctx, proposer, "retirement_decision", {
      itemId: item._id,
      itemTitle: item.title,
      approved: args.approve,
      note: args.note ?? null,
    });
  },
});
