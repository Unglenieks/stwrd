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

const cat = (t: T) => t.run((c) => c.db.insert("categories", { name: "Tools", archived: false }));
const photo = (t: T) =>
  t.run((c) => c.storage.store(new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" })));
const ledgerOf = (t: T, itemId: Id<"items">) =>
  t.run((c) => c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect());

describe("repair (§10)", () => {
  test("repairComplete: UNDER_REPAIR → IN_CUSTODY, raising the condition", async () => {
    const t = convexTest(schema, modules);
    const fixer = await seedUser(t, MEMBER_PERMISSIONS);
    const categoryId = await cat(t);
    const itemId = await seedItem(t, { custodianId: fixer, categoryId });
    await t.run((c) => c.db.patch(itemId, { state: "under_repair", conditionRating: 2 }));

    await asUser(t, fixer).action(api.items.repairComplete, {
      itemId,
      note: "replaced the belt",
      newCondition: 4,
    });

    const item = await t.run((c) => c.db.get(itemId));
    expect(item?.state).toBe("in_custody");
    expect(item?.conditionRating).toBe(4);
    expect((await ledgerOf(t, itemId)).some((e) => e.type === "repair_completed")).toBe(true);
  });

  test("repairComplete is rejected outside UNDER_REPAIR (state_conflict)", async () => {
    const t = convexTest(schema, modules);
    const fixer = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: fixer, categoryId: await cat(t) }); // AVAILABLE
    await expect(
      asUser(t, fixer).action(api.items.repairComplete, { itemId, note: "x", newCondition: 4 }),
    ).rejects.toThrow(/state_conflict/);
  });
});

describe("retirement (§11)", () => {
  async function proposeAs(t: T, perms: string[]) {
    const user = await seedUser(t, perms);
    const itemId = await seedItem(t, { custodianId: user, categoryId: await cat(t) });
    await t.run((c) => c.db.patch(itemId, { state: "in_custody" }));
    await asUser(t, user).action(api.items.proposeRetirement, {
      itemId,
      reason: "beyond repair",
      photoIds: [await photo(t)],
    });
    return { user, itemId };
  }

  test("propose → approve retires the item (terminal); record remains", async () => {
    const t = convexTest(schema, modules);
    const { user, itemId } = await proposeAs(t, [
      PERMISSIONS.itemsRetirePropose,
      PERMISSIONS.itemsRetireApprove,
    ]);
    // Sole approver may approve their own proposal (audited).
    await asUser(t, user).mutation(api.retirements.decide, { itemId, approve: true });
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("retired");
    const ledger = await ledgerOf(t, itemId);
    expect(ledger.some((e) => e.type === "retirement_proposed")).toBe(true);
    expect(ledger.some((e) => e.type === "retired")).toBe(true);
  });

  test("proposer cannot approve their own proposal when other approvers exist", async () => {
    const t = convexTest(schema, modules);
    const { user, itemId } = await proposeAs(t, [
      PERMISSIONS.itemsRetirePropose,
      PERMISSIONS.itemsRetireApprove,
    ]);
    const other = await seedUser(t, [PERMISSIONS.itemsRetireApprove]); // a second approver exists
    await expect(
      asUser(t, user).mutation(api.retirements.decide, { itemId, approve: true }),
    ).rejects.toThrow(/forbidden/);
    // …but another approver can.
    await asUser(t, other).mutation(api.retirements.decide, { itemId, approve: true });
    expect((await t.run((c) => c.db.get(itemId)))?.state).toBe("retired");
  });

  test("approval is blocked during a live claim (state_conflict)", async () => {
    const t = convexTest(schema, modules);
    const proposer = await seedUser(t, [
      PERMISSIONS.itemsRetirePropose,
      PERMISSIONS.itemsRetireApprove,
    ]);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: proposer, categoryId: await cat(t) });
    await asUser(t, proposer).action(api.items.proposeRetirement, {
      itemId,
      reason: "maybe",
      photoIds: [await photo(t)],
    });
    // A fixer claims the (still AVAILABLE) item → live claim.
    await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "repair" });
    await expect(
      asUser(t, proposer).mutation(api.retirements.decide, { itemId, approve: true }),
    ).rejects.toThrow(/state_conflict/);
  });
});

describe("watching (§9.5) + notifications (§14)", () => {
  test("markAvailable fires watched_item_available to watchers, not the actor", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const watcher = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: holder, categoryId: await cat(t) });
    await t.run((c) => c.db.patch(itemId, { state: "in_custody" }));

    // Watcher watches; holder also watches their own item (allowed, but suppressed).
    expect(await asUser(t, watcher).mutation(api.watches.toggle, { itemId })).toEqual({ watching: true });
    await asUser(t, holder).mutation(api.watches.toggle, { itemId });

    await asUser(t, holder).mutation(api.items.markAvailable, { itemId, exchangeMode: "reveal_contact" });

    const watcherNotes = await asUser(t, watcher).query(api.notifications.list, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(watcherNotes.page.some((n) => n.kind === "watched_item_available")).toBe(true);
    const holderNotes = await asUser(t, holder).query(api.notifications.list, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(holderNotes.page.some((n) => n.kind === "watched_item_available")).toBe(false);
  });

  test("toggle off removes the watch; unread count + markRead work", async () => {
    const t = convexTest(schema, modules);
    const u = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: await seedUser(t, MEMBER_PERMISSIONS), categoryId: await cat(t) });
    await asUser(t, u).mutation(api.watches.toggle, { itemId });
    expect(await asUser(t, u).mutation(api.watches.toggle, { itemId })).toEqual({ watching: false });

    // Seed a notification and exercise the inbox.
    await t.run((c) => c.db.insert("notifications", { userId: u, kind: "security_alert", payload: {}, read: false, createdAt: Date.now() }));
    expect(await asUser(t, u).query(api.notifications.unreadCount, {})).toBe(1);
    await asUser(t, u).mutation(api.notifications.markAllRead, {});
    expect(await asUser(t, u).query(api.notifications.unreadCount, {})).toBe(0);
  });

  test("an email-pref recipient also gets a queued outbox row", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    await t.run((c) => c.db.patch(holder, { notificationPref: "email" }));
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const itemId = await seedItem(t, { custodianId: holder, categoryId: await cat(t) });
    await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });

    const outbox = await t.run((c) => c.db.query("emailOutbox").collect());
    expect(outbox.some((m) => m.template === "claim_placed" && m.to)).toBe(true);
  });
});
