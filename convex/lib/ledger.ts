// The append-only ledger writer (spec §7.4, §8.3).
//
// THE only path that writes ledgerEntries. `seq` comes from items.ledgerSeq,
// incremented in the SAME mutation that inserts the entry — transactional, so
// per-item seq strictly increases by 1 with no gaps or dupes (C-14, C-20). No
// code ever updates or deletes a ledger row.
import type { LedgerEntryType } from "@lot/shared";
import { AppError } from "@lot/shared";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface LedgerInput {
  type: LedgerEntryType;
  actorId: Id<"users">;
  counterpartyId?: Id<"users">;
  claimId?: Id<"claims">;
  conditionRating?: number;
  note?: string;
  photoFileIds?: Id<"_storage">[];
  branchId?: Id<"branches">;
  reason?: string;
  correctsSeq?: number;
}

/**
 * Append a ledger entry for `item` and bump its `ledgerSeq` atomically. Pass the
 * already-loaded item doc so the caller's other state changes share the same
 * transaction. Returns the new seq.
 */
export async function appendLedger(
  ctx: MutationCtx,
  item: Doc<"items">,
  entry: LedgerInput,
): Promise<number> {
  const seq = item.ledgerSeq + 1;
  await ctx.db.insert("ledgerEntries", {
    itemId: item._id,
    seq,
    type: entry.type,
    actorId: entry.actorId,
    counterpartyId: entry.counterpartyId,
    claimId: entry.claimId,
    conditionRating: entry.conditionRating,
    note: entry.note,
    photoFileIds: entry.photoFileIds ?? [],
    branchId: entry.branchId,
    reason: entry.reason,
    correctsSeq: entry.correctsSeq,
    createdAt: Date.now(),
  });
  await ctx.db.patch(item._id, { ledgerSeq: seq });
  return seq;
}

/** Load an item or throw `not_found`. */
export async function getItemOrThrow(
  ctx: MutationCtx,
  itemId: Id<"items">,
): Promise<Doc<"items">> {
  const item = await ctx.db.get(itemId);
  if (!item) throw new AppError("not_found");
  return item;
}
