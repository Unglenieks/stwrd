/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@lot/shared";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

type T = ReturnType<typeof convexTest<typeof schema>>;

/** A clean image (no metadata markers) — passes EXIF verification. */
function cleanPhoto(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // RIFF…WEBP, no chunks
}

/** A WebP carrying an EXIF chunk — must be rejected (C-19). */
function exifPhoto(): Uint8Array {
  const enc = new TextEncoder();
  return new Uint8Array([
    ...enc.encode("RIFF"), 0, 0, 0, 0, ...enc.encode("WEBP"),
    ...enc.encode("EXIF"), 4, 0, 0, 0, 1, 2, 3, 4,
  ]);
}

async function storePhoto(t: T, bytes: Uint8Array): Promise<Id<"_storage">> {
  return t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/webp" })));
}

async function seedCategory(t: T): Promise<Id<"categories">> {
  return t.run((ctx) =>
    ctx.db.insert("categories", { name: "Tools", archived: false }),
  );
}

describe("contribution (§8.2)", () => {
  test("happy path: creates an AVAILABLE item with a `contributed` genesis entry", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, [PERMISSIONS.itemsContribute]);
    const as = asUser(t, userId);
    const categoryId = await seedCategory(t);
    const photoId = await storePhoto(t, cleanPhoto());

    const itemId = await as.action(api.items.contribute, {
      title: "Cordless drill",
      description: "18V",
      categoryId,
      tags: ["Drill", "POWER"],
      attributes: [{ key: "voltage", value: "18V" }],
      condition: 4,
      photoIds: [photoId],
      exchangeMode: "reveal_contact",
    });

    const { item, ledger } = await t.run(async (ctx) => ({
      item: await ctx.db.get(itemId),
      ledger: await ctx.db
        .query("ledgerEntries")
        .withIndex("by_item_seq", (q) => q.eq("itemId", itemId))
        .collect(),
    }));
    expect(item?.state).toBe("available");
    expect(item?.custodianId).toBe(userId);
    expect(item?.conditionRating).toBe(4);
    expect(item?.tags).toEqual(["drill", "power"]); // normalized
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.type).toBe("contributed");
    expect(ledger[0]?.seq).toBe(1);
    expect(ledger[0]?.photoFileIds).toEqual([photoId]);
  });

  test("requires items.contribute permission", async () => {
    const t = convexTest(schema, modules);
    const as = asUser(t, await seedUser(t, []));
    const categoryId = await seedCategory(t);
    const photoId = await storePhoto(t, cleanPhoto());
    await expect(
      as.action(api.items.contribute, {
        title: "x", description: "", categoryId, tags: [], attributes: [],
        condition: 3, photoIds: [photoId], exchangeMode: "reveal_contact",
      }),
    ).rejects.toThrow(/forbidden/);
  });

  test("rejects a photo that still carries EXIF/GPS metadata (C-19)", async () => {
    const t = convexTest(schema, modules);
    const as = asUser(t, await seedUser(t, [PERMISSIONS.itemsContribute]));
    const categoryId = await seedCategory(t);
    const dirty = await storePhoto(t, exifPhoto());
    await expect(
      as.action(api.items.contribute, {
        title: "x", description: "", categoryId, tags: [], attributes: [],
        condition: 3, photoIds: [dirty], exchangeMode: "reveal_contact",
      }),
    ).rejects.toThrow(/validation_failed/);
  });
});

describe("item lifecycle mutations (§22.3)", () => {
  async function contributeItem(t: T, userId: Id<"users">): Promise<Id<"items">> {
    const categoryId = await seedCategory(t);
    const photoId = await storePhoto(t, cleanPhoto());
    return asUser(t, userId).action(api.items.contribute, {
      title: "Item", description: "", categoryId, tags: [], attributes: [],
      condition: 4, photoIds: [photoId], exchangeMode: "reveal_contact",
    });
  }

  test("ledger seq strictly increments by 1 (C-14/C-20)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, [PERMISSIONS.itemsContribute, ...MEMBER_PERMISSIONS]);
    const itemId = await contributeItem(t, userId);
    await asUser(t, userId).action(api.items.statusUpdate, { itemId, note: "scratched the base" });

    const seqs = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("ledgerEntries")
          .withIndex("by_item_seq", (q) => q.eq("itemId", itemId))
          .collect()
      ).map((e) => e.seq),
    );
    expect(seqs).toEqual([1, 2]);
  });

  test("markAvailable only from IN_CUSTODY; withdrawListing returns to IN_CUSTODY", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, [PERMISSIONS.itemsContribute]);
    const itemId = await contributeItem(t, userId);
    const as = asUser(t, userId);

    // Fresh item is AVAILABLE → markAvailable is a state conflict.
    await expect(
      as.mutation(api.items.markAvailable, { itemId, exchangeMode: "reveal_contact" }),
    ).rejects.toThrow(/state_conflict/);

    // Withdraw the listing → IN_CUSTODY, then markAvailable works.
    await as.mutation(api.items.withdrawListing, { itemId });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.state).toBe("in_custody");
    await as.mutation(api.items.markAvailable, { itemId, exchangeMode: "branch" });
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.state).toBe("available");
    expect(item?.exchangePref).toBe("branch");
  });

  test("non-custodian without items.edit_any cannot update an item", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, [PERMISSIONS.itemsContribute]);
    const itemId = await contributeItem(t, owner);
    const stranger = await seedUser(t, MEMBER_PERMISSIONS);
    await expect(
      asUser(t, stranger).mutation(api.items.update, { itemId, patch: { title: "hijack" } }),
    ).rejects.toThrow(/forbidden/);
  });
});
