// Inbound email ingest (spec §13). The poll action (convex/imapPoll.ts, Node)
// hands each fetched message to this internal mutation, which does the
// classification: bounce/DSN, reply-captured-to-a-claim, or unmatched. Inbound
// mail NEVER triggers state changes — it is a passive coordination *record*
// (§1.2), so this only logs and notifies.
import { v } from "convex/values";
import { INBOUND_BODY_MAX_BYTES, INBOUND_REPLY_EXCERPT_MAX } from "@lot/shared";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { notify } from "./lib/notify";

const BOUNCE_FROM = /mailer-daemon|postmaster|no-?reply/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|failure notice|returned mail|mail delivery failed/i;
const LOT_TOKEN = /\[LOT#([^\]\s]+)\]/i;

export const ingestInbound = internalMutation({
  args: {
    imapUid: v.number(),
    from: v.string(),
    subject: v.string(),
    inReplyTo: v.optional(v.string()),
    toAddress: v.optional(v.string()),
    bodyText: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotent on UID (the poll may re-see a message).
    const dup = await ctx.db
      .query("emailInbound")
      .withIndex("by_uid", (q) => q.eq("imapUid", args.imapUid))
      .first();
    if (dup) return;

    const bodyText = args.bodyText.slice(0, INBOUND_BODY_MAX_BYTES);
    const isBounce = BOUNCE_FROM.test(args.from) || BOUNCE_SUBJECT.test(args.subject);

    let disposition: "logged" | "bounce" | "unmatched" = "unmatched";
    let matchedClaimId: Id<"claims"> | undefined;

    if (isBounce) {
      disposition = "bounce";
    } else {
      // Match a reply to a claim via the [LOT#<id>] subject token or the
      // plus-addressed recipient (library+claim-<id>@…).
      const token =
        args.subject.match(LOT_TOKEN)?.[1] ??
        args.toAddress?.match(/\+claim-([a-z0-9]+)@/i)?.[1];
      const claimId = token ? ctx.db.normalizeId("claims", token) : null;
      if (claimId) {
        const claim = await ctx.db.get(claimId);
        if (claim) {
          disposition = "logged";
          matchedClaimId = claim._id;
          const item = await ctx.db.get(claim.itemId);
          const fromName = args.from;
          const excerpt = bodyText.slice(0, INBOUND_REPLY_EXCERPT_MAX);
          // Append to the claim's coordination record (this row) and ping both
          // parties — a passive record, never a chat surface (§1.2).
          for (const uid of [claim.claimantId, item?.custodianId].filter(Boolean)) {
            await notify(ctx, uid!, "inbound_reply", {
              claimId: claim._id,
              itemId: claim.itemId,
              fromName,
              excerpt,
            });
          }
        }
      }
    }

    await ctx.db.insert("emailInbound", {
      imapUid: args.imapUid,
      from: args.from,
      subject: args.subject,
      inReplyTo: args.inReplyTo,
      matchedClaimId: matchedClaimId ?? undefined,
      bodyText,
      disposition,
      receivedAt: Date.now(),
    });
  },
});
