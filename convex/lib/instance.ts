// Helpers for the instanceSettings singleton and the audit feed (spec §7.10, §15).
import {
  CLAIM_EXPIRY_HOURS_DEFAULT,
  PHOTO_MAX_EDGE_PX_DEFAULT,
} from "@stwrd/shared";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The singleton settings row, or null before the setup wizard runs (§6.3). */
export async function getSettings(ctx: QueryCtx | MutationCtx): Promise<Doc<"instanceSettings"> | null> {
  return ctx.db.query("instanceSettings").first();
}

/** Has bootstrap completed? Drives the /setup gate (C-01). */
export async function isSetupComplete(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const s = await getSettings(ctx);
  return Boolean(s?.setupCompleted);
}

/** Effective claim-expiry window in ms (org-configurable, default 168 h). */
export async function claimExpiryMs(ctx: QueryCtx | MutationCtx): Promise<number> {
  const s = await getSettings(ctx);
  const hours = s?.claimExpiryHours ?? CLAIM_EXPIRY_HOURS_DEFAULT;
  return hours * 60 * 60 * 1000;
}

export async function photoMaxEdgePx(ctx: QueryCtx | MutationCtx): Promise<number> {
  const s = await getSettings(ctx);
  return s?.photoMaxEdgePx ?? PHOTO_MAX_EDGE_PX_DEFAULT;
}

/** Append a sensitive-event row to the audit feed (§15 Audit & email). */
export async function recordAudit(
  ctx: MutationCtx,
  args: {
    actorId?: Id<"users">;
    action: string;
    targetId?: string;
    detail?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditEvents", {
    actorId: args.actorId,
    action: args.action,
    targetId: args.targetId,
    detail: args.detail ?? {},
    createdAt: Date.now(),
  });
}
