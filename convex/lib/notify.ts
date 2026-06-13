// In-app notifications (spec §14). Inserts a row into the reactive inbox. The
// email side (outbox enqueue per the recipient's preference) + the inbox UI land
// in Phase 3; this is the write primitive the circulation flows call now so the
// data is captured from the start.
import type { NotificationKind } from "@lot/shared";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function notify(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: NotificationKind,
  payload: unknown,
): Promise<void> {
  await ctx.db.insert("notifications", {
    userId,
    kind,
    payload,
    read: false,
    createdAt: Date.now(),
  });
}
