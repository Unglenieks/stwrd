/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { buildSearchText } from "./lib/search";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

type T = ReturnType<typeof convexTest<typeof schema>>;
const PAGE = { numItems: 24, cursor: null };

async function seedCategory(t: T, name = "Tools"): Promise<Id<"categories">> {
  return t.run((ctx) => ctx.db.insert("categories", { name, archived: false }));
}

async function seedItem(
  t: T,
  custodianId: Id<"users">,
  categoryId: Id<"categories">,
  o: { title: string; description?: string; tags?: string[]; condition?: number; state?: "available" | "retired"; lastAvailableAt?: number },
): Promise<Id<"items">> {
  return t.run(async (ctx) => {
    const photoId = await ctx.storage.store(new Blob(["x"], { type: "image/webp" }));
    const tags = o.tags ?? [];
    const now = o.lastAvailableAt ?? Date.now();
    return ctx.db.insert("items", {
      title: o.title,
      description: o.description ?? "",
      categoryId,
      tags,
      attributes: [],
      state: o.state ?? "available",
      custodianId,
      conditionRating: o.condition ?? 4,
      primaryPhotoId: photoId,
      ledgerSeq: 0,
      exchangePref: "reveal_contact",
      contributedBy: custodianId,
      contributedAt: now,
      lastAvailableAt: now,
      searchText: buildSearchText({ title: o.title, description: o.description ?? "", tags }),
    });
  });
}

describe("items.list (§17)", () => {
  test("browse excludes RETIRED by default and sorts most-recently-available first", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t, []);
    const cat = await seedCategory(t);
    await seedItem(t, user, cat, { title: "Old drill", lastAvailableAt: 1000 });
    await seedItem(t, user, cat, { title: "New ladder", lastAvailableAt: 5000 });
    await seedItem(t, user, cat, { title: "Retired saw", state: "retired", lastAvailableAt: 9000 });

    const res = await asUser(t, user).query(api.items.list, { paginationOpts: PAGE });
    expect(res.page.map((i) => i.title)).toEqual(["New ladder", "Old drill"]); // retired excluded, newest first
  });

  test("includeRetired surfaces retired items", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t, []);
    const cat = await seedCategory(t);
    await seedItem(t, user, cat, { title: "Retired saw", state: "retired" });
    const res = await asUser(t, user).query(api.items.list, {
      paginationOpts: PAGE,
      includeRetired: true,
    });
    expect(res.page).toHaveLength(1);
  });

  test("condition range and tag filters apply", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t, []);
    const cat = await seedCategory(t);
    await seedItem(t, user, cat, { title: "Mint drill", condition: 5, tags: ["drill"] });
    await seedItem(t, user, cat, { title: "Worn drill", condition: 2, tags: ["drill", "needs-repair"] });
    await seedItem(t, user, cat, { title: "Mint bike", condition: 5, tags: ["bike"] });

    const lowCondition = await asUser(t, user).query(api.items.list, {
      paginationOpts: PAGE,
      conditionMax: 2,
    });
    expect(lowCondition.page.map((i) => i.title)).toEqual(["Worn drill"]);

    const drills = await asUser(t, user).query(api.items.list, {
      paginationOpts: PAGE,
      tags: ["drill"],
    });
    expect(drills.page.map((i) => i.title).sort()).toEqual(["Mint drill", "Worn drill"]);
  });
});

describe("items.get & items.ledger (§16)", () => {
  test("get returns detail; ledger returns entries newest first", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t, [], { name: "Dana" });
    const cat = await seedCategory(t, "Garden");
    const itemId = await seedItem(t, user, cat, { title: "Wheelbarrow", tags: ["garden"] });
    // Two ledger entries.
    await t.run(async (ctx) => {
      const item = (await ctx.db.get(itemId))!;
      await ctx.db.insert("ledgerEntries", {
        itemId, seq: 1, type: "contributed", actorId: user, conditionRating: 4,
        photoFileIds: [item.primaryPhotoId], createdAt: 1000,
      });
      await ctx.db.insert("ledgerEntries", {
        itemId, seq: 2, type: "status_update", actorId: user, note: "cleaned it up",
        photoFileIds: [], createdAt: 2000,
      });
      await ctx.db.patch(itemId, { ledgerSeq: 2 });
    });

    const detail = await asUser(t, user).query(api.items.get, { itemId });
    expect(detail.title).toBe("Wheelbarrow");
    expect(detail.custodianName).toBe("Dana");
    expect(detail.categoryName).toBe("Garden");
    expect(detail.isMine).toBe(true);
    expect(detail.hasLiveClaim).toBe(false);

    const timeline = await asUser(t, user).query(api.items.ledger, { itemId, paginationOpts: PAGE });
    expect(timeline.page.map((e) => e.seq)).toEqual([2, 1]); // newest first
    expect(timeline.page[0]?.actorName).toBe("Dana");
    expect(timeline.page[0]?.note).toBe("cleaned it up");
  });

  test("get on a missing item throws not_found", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t, []);
    const cat = await seedCategory(t);
    const itemId = await seedItem(t, user, cat, { title: "Temp" });
    await t.run((ctx) => ctx.db.delete(itemId));
    await expect(asUser(t, user).query(api.items.get, { itemId })).rejects.toThrow(/not_found/);
  });
});
