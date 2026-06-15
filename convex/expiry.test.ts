/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { MEMBER_PERMISSIONS } from "@stwrd/shared";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser, seedItem, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema>>;

async function seedCategory(t: T): Promise<Id<"categories">> {
  return t.run((ctx) => ctx.db.insert("categories", { name: "Tools", archived: false }));
}

/** Place a real claim, then backdate its expiry to simulate the window passing. */
async function claimThenExpire(t: T, partial: "none" | "giver" = "none") {
  const holder = await seedUser(t, MEMBER_PERMISSIONS);
  const claimant = await seedUser(t, MEMBER_PERMISSIONS);
  const categoryId = await seedCategory(t);
  const itemId = await seedItem(t, { custodianId: holder, categoryId });
  const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
  if (partial === "giver") await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId });
  await t.run((ctx) => ctx.db.patch(claimId, { expiresAt: Date.now() - 1000 }));
  return { holder, claimant, itemId, claimId };
}

describe("claim expiry (§9.3, §23.2)", () => {
  test("C-09: an unconfirmed expired claim is swept → cancelled, item AVAILABLE, both notified", async () => {
    const t = convexTest(schema, modules);
    const { holder, claimant, itemId, claimId } = await claimThenExpire(t, "none");

    await t.mutation(internal.claims.sweepExpired, {});

    expect((await t.run((c) => c.db.get(claimId)))?.state).toBe("cancelled");
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("available");
    const ledger = await t.run((c) =>
      c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect(),
    );
    expect(ledger.find((e) => e.type === "claim_cancelled")?.reason).toBe("expired");
    for (const uid of [holder, claimant]) {
      const ns = await t.run((c) =>
        c.db.query("notifications").withIndex("by_user_read", (q) => q.eq("userId", uid).eq("read", false)).collect(),
      );
      expect(ns.some((n) => n.kind === "claim_cancelled")).toBe(true);
    }
  });

  test("C-10: a half-confirmed expired claim is SKIPPED by the sweep", async () => {
    const t = convexTest(schema, modules);
    const { itemId, claimId } = await claimThenExpire(t, "giver");

    await t.mutation(internal.claims.sweepExpired, {});

    // Still live; not reverted (it belongs in the admin stuck-handoffs queue).
    expect((await t.run((c) => c.db.get(claimId)))?.state).toBe("giver_confirmed");
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("claimed");
  });

  test("expiring notifier warns once per claim", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const categoryId = await seedCategory(t);
    const itemId = await seedItem(t, { custodianId: holder, categoryId });
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    // Expiry within the 24h warning window.
    await t.run((ctx) => ctx.db.patch(claimId, { expiresAt: Date.now() + 60 * 60 * 1000 }));

    await t.mutation(internal.claims.notifyExpiring, {});
    await t.mutation(internal.claims.notifyExpiring, {}); // second run must not re-warn

    const warnings = await t.run((c) =>
      c.db
        .query("notifications")
        .withIndex("by_user_read", (q) => q.eq("userId", claimant).eq("read", false))
        .collect(),
    );
    expect(warnings.filter((n) => n.kind === "claim_expiring")).toHaveLength(1);
  });
});

describe("me.* (§16)", () => {
  test("custody, claims, and contributions are scoped to the signed-in user", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const categoryId = await seedCategory(t);
    const itemId = await seedItem(t, { custodianId: holder, categoryId });
    await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });

    expect(await asUser(t, holder).query(api.me.custody, {})).toHaveLength(1);
    expect(await asUser(t, holder).query(api.me.contributions, {})).toHaveLength(1);
    const claimantClaims = await asUser(t, claimant).query(api.me.claims, {});
    expect(claimantClaims).toHaveLength(1);
    expect(claimantClaims[0]?.itemId).toBe(itemId);
  });
});
