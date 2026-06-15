/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@stwrd/shared";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser, seedItem, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema>>;

async function seedCategory(t: T): Promise<Id<"categories">> {
  return t.run((ctx) => ctx.db.insert("categories", { name: "Tools", archived: false }));
}
async function cleanPhoto(t: T): Promise<Id<"_storage">> {
  return t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" })),
  );
}
async function setup(t: T) {
  const holder = await seedUser(t, MEMBER_PERMISSIONS, { name: "Holder" });
  const claimant = await seedUser(t, MEMBER_PERMISSIONS, { name: "Claimant" });
  const categoryId = await seedCategory(t);
  const itemId = await seedItem(t, { custodianId: holder, categoryId });
  return { holder, claimant, itemId };
}

describe("claim & handoff (§9)", () => {
  test("C-06 happy path: claim → both confirm (receiver photo) → custody moves", async () => {
    const t = convexTest(schema, modules);
    const { holder, claimant, itemId } = await setup(t);

    const claimId = await asUser(t, claimant).mutation(api.claims.create, {
      itemId,
      purpose: "use",
    });
    // Item is CLAIMED, holder notified, `claimed` entry written.
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("claimed");
    const notif = await t.run((c) =>
      c.db.query("notifications").withIndex("by_user_read", (q) => q.eq("userId", holder).eq("read", false)).collect(),
    );
    expect(notif.some((n) => n.kind === "claim_placed")).toBe(true);

    const photo = await cleanPhoto(t);
    await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId });
    await asUser(t, claimant).action(api.claims.confirmReceiver, {
      claimId,
      photoIds: [photo],
      condition: 3,
    });

    const item = await t.run((c) => c.db.get(itemId));
    expect(item?.state).toBe("in_custody");
    expect(item?.custodianId).toBe(claimant);
    expect(item?.conditionRating).toBe(3); // receiver's rating is authoritative

    const ledger = await t.run((c) =>
      c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect(),
    );
    expect(ledger.map((e) => e.type)).toEqual(["claimed", "handoff_completed"]);
    expect(ledger.map((e) => e.seq)).toEqual([1, 2]);
    const handoff = ledger.find((e) => e.type === "handoff_completed")!;
    expect(handoff.photoFileIds).toEqual([photo]); // C-08: always carries a photo
    expect(handoff.conditionRating).toBe(3);
  });

  test("C-08: confirmReceiver without a photo is rejected (photo_required)", async () => {
    const t = convexTest(schema, modules);
    const { holder, claimant, itemId } = await setup(t);
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId });
    await expect(
      asUser(t, claimant).action(api.claims.confirmReceiver, { claimId, photoIds: [], condition: 4 }),
    ).rejects.toThrow(/photo_required/);
  });

  test("C-07 (guard): a second live claim on the same item is rejected", async () => {
    const t = convexTest(schema, modules);
    const { claimant, itemId } = await setup(t);
    const other = await seedUser(t, MEMBER_PERMISSIONS);
    await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await expect(
      asUser(t, other).mutation(api.claims.create, { itemId, purpose: "use" }),
    ).rejects.toThrow(/item_not_available/);
  });

  test("a custodian cannot claim their own item (self_claim_forbidden)", async () => {
    const t = convexTest(schema, modules);
    const { holder, itemId } = await setup(t);
    await expect(
      asUser(t, holder).mutation(api.claims.create, { itemId, purpose: "use" }),
    ).rejects.toThrow(/self_claim_forbidden/);
  });

  test("repair-purpose handoff lands the item in UNDER_REPAIR", async () => {
    const t = convexTest(schema, modules);
    const { holder, claimant, itemId } = await setup(t);
    const claimId = await asUser(t, claimant).mutation(api.claims.create, {
      itemId,
      purpose: "repair",
    });
    const photo = await cleanPhoto(t);
    await asUser(t, claimant).action(api.claims.confirmReceiver, { claimId, photoIds: [photo], condition: 2 });
    await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId }); // order is free
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("under_repair");
  });

  test("claimant can cancel; item returns to AVAILABLE with reason by_claimant", async () => {
    const t = convexTest(schema, modules);
    const { claimant, itemId } = await setup(t);
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await asUser(t, claimant).mutation(api.claims.cancel, { claimId });

    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("available");
    const ledger = await t.run((c) =>
      c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect(),
    );
    const cancel = ledger.find((e) => e.type === "claim_cancelled")!;
    expect(cancel.reason).toBe("by_claimant");
    expect((await t.run((c) => c.db.get(claimId)))?.state).toBe("cancelled");
  });

  test("a stranger cannot cancel someone else's claim", async () => {
    const t = convexTest(schema, modules);
    const { claimant, itemId } = await setup(t);
    const stranger = await seedUser(t, MEMBER_PERMISSIONS);
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await expect(
      asUser(t, stranger).mutation(api.claims.cancel, { claimId }),
    ).rejects.toThrow(/forbidden/);
  });
});
