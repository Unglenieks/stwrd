// In-app notifications (spec §14). Inserts a row into the reactive inbox. The
// email side (outbox enqueue per the recipient's preference) + the inbox UI land
// in Phase 3; this is the write primitive the circulation flows call now so the
// data is captured from the start.
import type { NotificationKind } from "@lot/shared";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueEmail } from "../email";
import { EMAIL_TEMPLATE_FOR_KIND } from "./emailTemplates";

export async function notify(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: NotificationKind,
  payload: unknown,
): Promise<void> {
  const user = await ctx.db.get(userId);
  // Everyone always gets the in-app version (§14). Mirror to email only when the
  // recipient prefers email, has an address, and the kind has a template (§13).
  const template = EMAIL_TEMPLATE_FOR_KIND[kind];
  const wantsEmail =
    user?.notificationPref === "email" && Boolean(user.email) && Boolean(template);

  await ctx.db.insert("notifications", {
    userId,
    kind,
    payload,
    read: false,
    emailState: wantsEmail ? "queued" : "skipped",
    createdAt: Date.now(),
  });

  if (wantsEmail && user?.email && template) {
    await enqueueEmail(ctx, {
      to: user.email,
      template,
      payload: payload as Record<string, unknown>,
      claimId: (payload as { claimId?: Id<"claims"> })?.claimId,
    });
  }
}

/**
 * Notify every watcher of an item that it just became AVAILABLE
 * (`watched_item_available`), except the actor whose action made it available
 * (§9.5, §22.4). Watching confers no priority — the notification is a starting
 * gun, not a place in line.
 */
export async function notifyWatchers(
  ctx: MutationCtx,
  itemId: Id<"items">,
  itemTitle: string,
  exceptUserId: Id<"users">,
): Promise<void> {
  const watches = await ctx.db
    .query("watches")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .collect();
  for (const w of watches) {
    if (w.userId === exceptUserId) continue;
    await notify(ctx, w.userId, "watched_item_available", { itemId, itemTitle });
  }
}
