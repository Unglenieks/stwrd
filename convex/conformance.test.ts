/// <reference types="vite/client" />
// §24 conformance scenarios — backend-expressible cases with stable C-## IDs.
// UI-observable scenarios live in apps/web/tests (also C-##-titled); the full
// 1:1 map is docs/conformance.md.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
  ALL_PERMISSIONS,
  EMAIL_OTP_MAX_ATTEMPTS,
  MEMBER_PERMISSIONS,
  PERMISSIONS,
} from "@stwrd/shared";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { hashToken } from "./lib/tokens";
import { asUser, seedItem, seedUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema>>;
const cat = (t: T) => t.run((c) => c.db.insert("categories", { name: "Tools", archived: false }));

describe("§24 conformance (backend)", () => {
  test("C-02 invite: duplicate email rejected; past-TTL invite is not_found", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, [PERMISSIONS.usersCreate]);
    const inviter = asUser(t, admin);

    await inviter.mutation(internal.users.createInvite, {
      name: "Jo",
      email: "jo@x.test",
      tokenHash: await hashToken("tok-1"),
      inviteUrl: "http://x/invite/tok-1",
    });
    // Duplicate (still-invited) email → validation_failed.
    await expect(
      inviter.mutation(internal.users.createInvite, {
        name: "Jo again",
        email: "jo@x.test",
        tokenHash: await hashToken("tok-2"),
        inviteUrl: "http://x/invite/tok-2",
      }),
    ).rejects.toThrow(/validation_failed/);

    // A past-TTL invite is reported expired by the accept-time lookup.
    await t.run(async (ctx) => {
      const inv = await ctx.db.query("invites").first();
      if (inv) await ctx.db.patch(inv._id, { expiresAt: Date.now() - 1000 });
    });
    const looked = await t.query(internal.authInternal.inviteByTokenHash, {
      tokenHash: await hashToken("tok-1"),
    });
    expect(looked?.expired).toBe(true);
  });

  test("C-03 email OTP locks out after the attempt cap", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, MEMBER_PERMISSIONS);
    await t.mutation(internal.authInternal.createEmailOtp, {
      userId,
      codeHash: await hashToken("123456"),
      ttlMs: 10 * 60 * 1000,
    });
    const wrong = await hashToken("000000");
    let last = "";
    for (let i = 0; i < EMAIL_OTP_MAX_ATTEMPTS; i++) {
      last = await t.mutation(internal.authInternal.consumeEmailOtp, { userId, codeHash: wrong });
    }
    expect(last).toBe("locked");
    // Even the correct code is refused while locked.
    const afterLock = await t.mutation(internal.authInternal.consumeEmailOtp, {
      userId,
      codeHash: await hashToken("123456"),
    });
    expect(afterLock).toBe("locked");
  });

  test("C-05 recovery codes are single-use; regeneration voids the prior set", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, MEMBER_PERMISSIONS);
    const codeA = await hashToken("aaaa-bbbb-cccc");
    const codeB = await hashToken("dddd-eeee-ffff");
    await t.mutation(internal.authInternal.setRecoveryCodes, { userId, hashes: [codeA, codeB] });

    expect(await t.mutation(internal.authInternal.consumeRecoveryCode, { userId, codeHash: codeA })).toBe(true);
    // Reuse fails.
    expect(await t.mutation(internal.authInternal.consumeRecoveryCode, { userId, codeHash: codeA })).toBe(false);

    // Regeneration voids the remaining old code.
    const codeC = await hashToken("gggg-hhhh-iiii");
    await t.mutation(internal.authInternal.setRecoveryCodes, { userId, hashes: [codeC] });
    expect(await t.mutation(internal.authInternal.consumeRecoveryCode, { userId, codeHash: codeB })).toBe(false);
    expect(await t.mutation(internal.authInternal.consumeRecoveryCode, { userId, codeHash: codeC })).toBe(true);
  });

  test("C-16 last-admin guard: removing the only full-permission member is blocked", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedUser(t, ALL_PERMISSIONS); // sole full-permission member
    const roleId = await t.run(async (ctx) => {
      const a = await ctx.db
        .query("roleAssignments")
        .withIndex("by_user", (q) => q.eq("userId", admin))
        .first();
      return a!.roleId;
    });
    // Unassigning their full-permission role would leave zero admins.
    await expect(
      asUser(t, admin).mutation(api.roles.assign, { userId: admin, roleId, remove: true }),
    ).rejects.toThrow(/last_admin_protected/);
    // Downgrading the role itself is likewise blocked.
    await expect(
      asUser(t, admin).mutation(api.roles.upsert, {
        roleId,
        name: "Server Manager",
        description: "",
        permissions: [PERMISSIONS.itemsClaim],
      }),
    ).rejects.toThrow(/last_admin_protected/);
  });

  test("C-20 ledger seq strictly increments by 1 with no gaps or dupes", async () => {
    const t = convexTest(schema, modules);
    const holder = await seedUser(t, MEMBER_PERMISSIONS);
    const claimant = await seedUser(t, MEMBER_PERMISSIONS);
    const categoryId = await cat(t);
    const itemId = await seedItem(t, { custodianId: holder, categoryId });
    // Drive several ledger-writing operations.
    const claimId = await asUser(t, claimant).mutation(api.claims.create, { itemId, purpose: "use" });
    await asUser(t, holder).mutation(api.claims.confirmGiver, { claimId });
    const photo = await t.run((c) =>
      c.storage.store(new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" })),
    );
    await asUser(t, claimant).action(api.claims.confirmReceiver, { claimId, photoIds: [photo as Id<"_storage">], condition: 4 });
    await asUser(t, claimant).action(api.items.statusUpdate, { itemId, note: "all good" });

    const seqs = (
      await t.run((c) =>
        c.db.query("ledgerEntries").withIndex("by_item_seq", (q) => q.eq("itemId", itemId)).collect(),
      )
    ).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]); // claimed, handoff_completed, status_update — contiguous
    expect(new Set(seqs).size).toBe(seqs.length); // no dupes
  });
});
