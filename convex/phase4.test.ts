/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@stwrd/shared";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser, seedItem, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema>>;

const cat = (t: T) => t.run((c) => c.db.insert("categories", { name: "Tools", archived: false }));
const photo = (t: T) =>
  t.run((c) => c.storage.store(new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" })));
const ledgerTypes = async (t: T, itemId: Id<"items">) =>
  (await t.run((c) => c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect())).map((e) => e.type);

async function branch(t: T, hostId: Id<"users">) {
  return asUser(t, hostId).mutation(api.branches.create, {
    name: "Co-op shed",
    locationText: "blue shed behind the co-op",
    accessNotes: "combo 4312",
  });
}

describe("branches (§12)", () => {
  test("create + deactivation blocked while an item is flagged (branch_has_items)", async () => {
    const t = convexTest(schema, modules);
    const host = await seedUser(t, MEMBER_PERMISSIONS);
    const branchId = await branch(t, host);
    // Flag an item to the branch directly.
    const itemId = await seedItem(t, { custodianId: host, categoryId: await cat(t) });
    await t.run((c) => c.db.patch(itemId, { atBranchId: branchId }));

    await expect(
      asUser(t, host).mutation(api.branches.update, { branchId, patch: { status: "inactive" } }),
    ).rejects.toThrow(/branch_has_items/);

    // Once unflagged, deactivation works.
    await t.run((c) => c.db.patch(itemId, { atBranchId: undefined }));
    await asUser(t, host).mutation(api.branches.update, { branchId, patch: { status: "inactive" } });
    expect((await t.run((c) => c.db.get(branchId)))?.status).toBe("inactive");
  });

  test("C-12 branch drop: marked_available → placed_at_branch → removed_from_branch", async () => {
    const t = convexTest(schema, modules);
    const host = await seedUser(t, MEMBER_PERMISSIONS);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const branchId = await branch(t, host);
    const itemId = await seedItem(t, { custodianId: holder, categoryId: await cat(t) });
    await t.run((c) => c.db.patch(itemId, { state: "in_custody" }));

    // List at the branch → item flagged there.
    await asUser(t, holder).mutation(api.items.markAvailable, { itemId, exchangeMode: "branch", branchId });
    expect((await t.run((c) => c.db.get(itemId)))?.atBranchId).toBe(branchId);

    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId }); // "dropped off"
    await asUser(t, claimant).action(api.claims.confirmReceiver, {
      claimId, photoIds: [await photo(t)], condition: 4,
    });

    const item = await t.run((c) => c.db.get(itemId));
    expect(item?.custodianId).toBe(claimant);
    expect(item?.atBranchId).toBeUndefined();
    const types = await ledgerTypes(t, itemId);
    expect(types).toContain("placed_at_branch");
    expect(types).toContain("removed_from_branch");
    expect(types).toContain("handoff_completed");
  });

  test("C-13 staging: deposit transfers custody to the host with placed_at_branch", async () => {
    const t = convexTest(schema, modules);
    const host = await seedUser(t, MEMBER_PERMISSIONS);
    const depositor = await seedUser(t, MEMBER_PERMISSIONS);
    const branchId = await branch(t, host);
    const itemId = await seedItem(t, { custodianId: depositor, categoryId: await cat(t) });

    const claimId = await asUser(t, depositor).mutation(api.claims.createStaging, { itemId, branchId });
    await asUser(t, depositor).mutation(api.claims.confirmGiver, { claimId });
    await asUser(t, host).action(api.claims.confirmReceiver, { claimId, photoIds: [await photo(t)], condition: 4 });

    const item = await t.run((c) => c.db.get(itemId));
    expect(item?.custodianId).toBe(host);
    expect(item?.state).toBe("in_custody");
    expect(item?.atBranchId).toBe(branchId);
    expect(await ledgerTypes(t, itemId)).toContain("placed_at_branch");
  });
});

describe("admin queues (§9.3, §15)", () => {
  async function liveClaim(t: T) {
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: holder, categoryId: await cat(t) });
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    return { holder, claimant, itemId, claimId };
  }

  test("C-11 adminResolve force_complete uses admin_transfer, never handoff_completed", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, [PERMISSIONS.claimsManageAny]);
    const { itemId, claimId, claimant } = await liveClaim(t);
    await asUser(t, admin).mutation(api.claims.adminResolve, {
      claimId, resolution: "force_complete", note: "both went quiet",
    });
    const item = await t.run((c) => c.db.get(itemId));
    expect(item?.custodianId).toBe(claimant);
    const types = await ledgerTypes(t, itemId);
    expect(types).toContain("admin_transfer");
    expect(types).not.toContain("handoff_completed");
  });

  test("adminResolve force_cancel returns the item to AVAILABLE (reason admin)", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, [PERMISSIONS.claimsManageAny]);
    const { itemId, claimId } = await liveClaim(t);
    await asUser(t, admin).mutation(api.claims.adminResolve, { claimId, resolution: "force_cancel", note: "stale" });
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("available");
  });

  test("C-17 deactivation cancels the member's pending claims; recovery queue lists held items", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, [PERMISSIONS.usersManage]);
    const { itemId, claimId, claimant, holder } = await liveClaim(t);

    await asUser(t, admin).mutation(api.users.deactivate, { userId: claimant });
    expect((await t.run((c) => c.db.get(claimId)))?.state).toBe("cancelled");
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("available");

    // The holder's held items appear in the recovery queue once THEY go inactive.
    await asUser(t, admin).mutation(api.users.deactivate, { userId: holder });
    const recovery = await asUser(t, admin).query(api.admin.recoveryQueue, {});
    expect(recovery.some((r) => r.itemId === itemId)).toBe(true);
  });

  test("adminTransfer needs items.edit_any AND claims.manage_any; records admin_transfer", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, [PERMISSIONS.itemsEditAny, PERMISSIONS.claimsManageAny]);
    const recipient = await seedUser(t, MEMBER_PERMISSIONS);
    const owner = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: owner, categoryId: await cat(t) });
    await t.run((c) => c.db.patch(itemId, { state: "in_custody" }));

    await asUser(t, admin).mutation(api.users.adminTransfer, {
      itemId, newCustodianId: recipient, note: "owner inactive; Jo recovered it",
    });
    expect((await t.run((c) => c.db.get(itemId)))?.custodianId).toBe(recipient);
    expect(await ledgerTypes(t, itemId)).toContain("admin_transfer");
  });
});

describe("inbound ingest (§13)", () => {
  test("a [STWRD#claimId] reply is captured to the claim and notifies both parties", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: holder, categoryId: await cat(t) });
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });

    await t.mutation(internal.inbound.ingestInbound, {
      imapUid: 1,
      from: "claimant@example.org",
      subject: `[STWRD#${claimId}] Re: pickup tonight`,
      bodyText: "I can grab it at 6pm.",
    });

    const inbound = await t.run((c) => c.db.query("emailInbound").collect());
    expect(inbound[0]?.disposition).toBe("logged");
    expect(inbound[0]?.matchedClaimId).toBe(claimId);
    const holderNotes = await asUser(t, holder).query(api.notifications.list, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(holderNotes.page.some((n) => n.kind === "inbound_reply")).toBe(true);
  });

  test("a bounce is classified, an unrelated message is unmatched; UID dedupes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.inbound.ingestInbound, {
      imapUid: 7, from: "MAILER-DAEMON@mx.example", subject: "Undelivered Mail Returned to Sender", bodyText: "550",
    });
    await t.mutation(internal.inbound.ingestInbound, {
      imapUid: 8, from: "someone@example.org", subject: "hello there", bodyText: "no token here",
    });
    await t.mutation(internal.inbound.ingestInbound, {
      imapUid: 8, from: "someone@example.org", subject: "hello there", bodyText: "duplicate uid",
    });

    const rows = await t.run((c) => c.db.query("emailInbound").collect());
    expect(rows.find((r) => r.imapUid === 7)?.disposition).toBe("bounce");
    expect(rows.find((r) => r.imapUid === 8)?.disposition).toBe("unmatched");
    expect(rows.filter((r) => r.imapUid === 8)).toHaveLength(1); // deduped
  });
});
