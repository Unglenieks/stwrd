// Email outbox (spec §7.9, §13). Mutations enqueue; a cron-driven action drains
// the queue with retry/backoff (the drain + IMAP poll land in Phase 3/4). The
// outbox doubles as the delivery log for the admin panel (§15).
import { v } from "convex/values";
import { OUTBOX_BACKOFF_MS, OUTBOX_MAX_ATTEMPTS } from "@lot/shared";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";

/** Enqueue an email for delivery. Safe to call from any mutation. */
export async function enqueueEmail(
  ctx: MutationCtx,
  args: { to: string; template: string; payload: unknown; claimId?: Id<"claims"> },
): Promise<Id<"emailOutbox">> {
  return ctx.db.insert("emailOutbox", {
    to: args.to,
    template: args.template,
    payload: args.payload,
    state: "queued",
    attempts: 0,
    nextAttemptAt: Date.now(),
    claimId: args.claimId,
    createdAt: Date.now(),
  });
}

/** Internal wrapper so actions (e.g. the auth OTP flow) can enqueue mail. */
export const enqueue = internalMutation({
  args: {
    to: v.string(),
    template: v.string(),
    payload: v.any(),
    claimId: v.optional(v.id("claims")),
  },
  handler: async (ctx, args) => {
    await enqueueEmail(ctx, args);
  },
});

/**
 * Backoff schedule accessor (1m / 10m / 60m across 3 attempts, §23.1).
 * `attempt` is clamped into range so a negative or overflowing index can never
 * yield `undefined` (which would otherwise collapse to a 0 ms retry storm).
 */
export function backoffForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 0), OUTBOX_BACKOFF_MS.length - 1);
  return OUTBOX_BACKOFF_MS[idx]!;
}

// ── Drain support (called by the Node drain action, §13) ─────────────────────

/** Queued messages whose next attempt is due. */
export const outboxDue = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const queued = await ctx.db
      .query("emailOutbox")
      .withIndex("by_state", (q) => q.eq("state", "queued"))
      .take(200);
    return queued.filter((m) => m.nextAttemptAt <= now).slice(0, limit);
  },
});

export const markSent = internalMutation({
  args: { id: v.id("emailOutbox"), messageId: v.optional(v.string()) },
  handler: async (ctx, { id, messageId }) => {
    await ctx.db.patch(id, { state: "sent", messageId });
  },
});

/** Record a failed attempt: retry with backoff, or mark failed after the cap. */
export const recordFailure = internalMutation({
  args: { id: v.id("emailOutbox"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const attempts = row.attempts + 1;
    if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      await ctx.db.patch(id, { state: "failed", attempts, lastError: error });
    } else {
      await ctx.db.patch(id, {
        attempts,
        lastError: error,
        nextAttemptAt: Date.now() + backoffForAttempt(attempts),
      });
    }
  },
});
