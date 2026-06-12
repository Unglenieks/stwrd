// Shared helpers for convex-test suites (spec §24 harness seed).
import type { TestConvex } from "convex-test";
import type { Id } from "./_generated/dataModel";
import type schema from "./schema";

type T = TestConvex<typeof schema>;

/** Insert an active user holding `permissions` (via a one-off role). Returns the userId. */
export async function seedUser(
  t: T,
  permissions: readonly string[] = [],
  overrides: { name?: string; email?: string } = {},
): Promise<Id<"users">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `u${Math.random().toString(36).slice(2)}@test.local`,
      status: "active",
      defaultExchangePref: null,
      notificationPref: "in_app",
      createdAt: Date.now(),
    });
    if (permissions.length > 0) {
      const roleId = await ctx.db.insert("roles", {
        name: `role-${Math.random().toString(36).slice(2)}`,
        description: "",
        permissions: [...permissions],
        isSystemDefault: false,
      });
      await ctx.db.insert("roleAssignments", { userId, roleId });
    }
    return userId;
  });
}

/** Bind a test client to a user's identity (Convex Auth subject is `userId|session`). */
export function asUser(t: T, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|testsession` });
}

/** Insert a minimal AVAILABLE item (for tests that need existing items). */
export async function seedItem(
  t: T,
  args: { custodianId: Id<"users">; categoryId: Id<"categories">; tags?: string[] },
): Promise<Id<"items">> {
  return t.run(async (ctx) => {
    const photoId = await ctx.storage.store(new Blob(["fake-image"], { type: "image/webp" }));
    const now = Date.now();
    return ctx.db.insert("items", {
      title: "Test item",
      description: "",
      categoryId: args.categoryId,
      tags: args.tags ?? [],
      attributes: [],
      state: "available",
      custodianId: args.custodianId,
      conditionRating: 4,
      primaryPhotoId: photoId,
      ledgerSeq: 0,
      exchangePref: "reveal_contact",
      contributedBy: args.custodianId,
      contributedAt: now,
      lastAvailableAt: now,
    });
  });
}
