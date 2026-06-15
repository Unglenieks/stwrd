/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@stwrd/shared";
import { api } from "./_generated/api";
import schema from "./schema";
import { asUser, seedItem, seedUser } from "./test.helpers";

// convex-test discovers the function modules via this glob.
const modules = import.meta.glob("./**/*.ts");

describe("categories (§7.7, §22.2)", () => {
  test("manager creates a tree; depth is capped at 3", async () => {
    const t = convexTest(schema, modules);
    const manager = await seedUser(t, [PERMISSIONS.categoriesManage]);
    const as = asUser(t, manager);

    const root = await as.mutation(api.categories.upsert, { name: "Tools" });
    const child = await as.mutation(api.categories.upsert, { name: "Power", parentId: root });
    const grandchild = await as.mutation(api.categories.upsert, {
      name: "Drills",
      parentId: child,
    });

    // A 4th level exceeds the depth limit.
    await expect(
      as.mutation(api.categories.upsert, { name: "Cordless", parentId: grandchild }),
    ).rejects.toThrow(/validation_failed/);

    const tree = await as.query(api.categories.tree, {});
    expect(tree.map((c) => c.name).sort()).toEqual(["Drills", "Power", "Tools"]);
  });

  test("non-managers cannot manage categories", async () => {
    const t = convexTest(schema, modules);
    const member = await seedUser(t, MEMBER_PERMISSIONS);
    await expect(
      asUser(t, member).mutation(api.categories.upsert, { name: "Nope" }),
    ).rejects.toThrow(/forbidden/);
  });

  test("a node cannot be re-parented under its own descendant", async () => {
    const t = convexTest(schema, modules);
    const as = asUser(t, await seedUser(t, [PERMISSIONS.categoriesManage]));
    const root = await as.mutation(api.categories.upsert, { name: "A" });
    const child = await as.mutation(api.categories.upsert, { name: "B", parentId: root });
    await expect(
      as.mutation(api.categories.upsert, { categoryId: root, name: "A", parentId: child }),
    ).rejects.toThrow(/validation_failed/);
  });

  test("editing a node's name preserves its parent and description (no silent re-parent)", async () => {
    const t = convexTest(schema, modules);
    const as = asUser(t, await seedUser(t, [PERMISSIONS.categoriesManage]));
    const root = await as.mutation(api.categories.upsert, { name: "Tools" });
    const child = await as.mutation(api.categories.upsert, {
      name: "Power",
      parentId: root,
      description: "powered tools",
    });

    // Rename only — parentId/description omitted.
    await as.mutation(api.categories.upsert, { categoryId: child, name: "Power tools" });

    const node = await t.run(async (ctx) => ctx.db.get(child));
    expect(node?.name).toBe("Power tools");
    expect(node?.parentId).toBe(root);
    expect(node?.description).toBe("powered tools");
  });

  test("archive never blocks and hides the node from default pickers; items keep the ref", async () => {
    const t = convexTest(schema, modules);
    const manager = await seedUser(t, [PERMISSIONS.categoriesManage]);
    const as = asUser(t, manager);
    const cat = await as.mutation(api.categories.upsert, { name: "Garden" });
    await seedItem(t, { custodianId: manager, categoryId: cat });

    await as.mutation(api.categories.archive, { categoryId: cat });

    expect(await as.query(api.categories.tree, {})).toHaveLength(0);
    expect(await as.query(api.categories.tree, { includeArchived: true })).toHaveLength(1);
    // The item still references the archived category.
    const stillReferenced = await t.run(async (ctx) => {
      const items = await ctx.db.query("items").collect();
      return items[0]?.categoryId === cat;
    });
    expect(stillReferenced).toBe(true);
  });
});

describe("tags (§7.7, §22.2)", () => {
  test("rename rewrites the tag across all items, de-duplicating", async () => {
    const t = convexTest(schema, modules);
    const manager = await seedUser(t, [PERMISSIONS.categoriesManage]);
    const as = asUser(t, manager);
    const cat = await as.mutation(api.categories.upsert, { name: "Misc" });
    await seedItem(t, { custodianId: manager, categoryId: cat, tags: ["drill", "cordless"] });
    await seedItem(t, { custodianId: manager, categoryId: cat, tags: ["drill", "power"] });

    const { touched } = await as.mutation(api.tags.rename, { from: "drill", to: "drills" });
    expect(touched).toBe(2);

    const counts = await as.query(api.tags.list, {});
    const byTag = Object.fromEntries(counts.map((c) => [c.tag, c.count]));
    expect(byTag.drills).toBe(2);
    expect(byTag.drill).toBeUndefined();
  });

  test("merge folds one tag into another without creating duplicates", async () => {
    const t = convexTest(schema, modules);
    const manager = await seedUser(t, [PERMISSIONS.categoriesManage]);
    const as = asUser(t, manager);
    const cat = await as.mutation(api.categories.upsert, { name: "Misc" });
    // An item carrying BOTH tags must not end up with a duplicate after merge.
    await seedItem(t, { custodianId: manager, categoryId: cat, tags: ["bike", "bicycle"] });

    await as.mutation(api.tags.merge, { from: "bicycle", to: "bike" });

    const tags = await t.run(async (ctx) => {
      const items = await ctx.db.query("items").collect();
      return items[0]?.tags;
    });
    expect(tags).toEqual(["bike"]);
  });

  test("tag input is normalized (trim + lowercase)", async () => {
    const t = convexTest(schema, modules);
    const manager = await seedUser(t, [PERMISSIONS.categoriesManage]);
    const as = asUser(t, manager);
    const cat = await as.mutation(api.categories.upsert, { name: "Misc" });
    await seedItem(t, { custodianId: manager, categoryId: cat, tags: ["drill"] });

    const { touched } = await as.mutation(api.tags.rename, { from: "  DRILL ", to: "Hand-Drill" });
    expect(touched).toBe(1);
    const tags = await t.run(async (ctx) => (await ctx.db.query("items").collect())[0]?.tags);
    expect(tags).toEqual(["hand-drill"]);
  });
});
