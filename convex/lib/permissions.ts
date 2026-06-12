// Server-side authorization — the single enforcement point (spec §5.1).
//
// Every privileged function calls requireUser / requirePermission. UI gating is
// cosmetic; THIS is the boundary. Effective permissions are the union across all
// of a member's roles.
import { getAuthUserId } from "@convex-dev/auth/server";
import { AppError, isFullPermissionSet, type Permission } from "@lot/shared";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** The authenticated, active user — or throw. Inactive accounts are blocked (§6.4). */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new AppError("unauthenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new AppError("unauthenticated");
  if (user.status === "inactive") throw new AppError("forbidden", "account deactivated");
  return user;
}

/** The current user id without loading the doc, or null if anonymous. */
export async function currentUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  return getAuthUserId(ctx);
}

/** Union of all permissions across the user's assigned roles. */
export async function getEffectivePermissions(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Set<string>> {
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const perms = new Set<string>();
  for (const a of assignments) {
    const role = await ctx.db.get(a.roleId);
    if (role) for (const p of role.permissions) perms.add(p);
  }
  return perms;
}

export async function userHasPermission(
  ctx: Ctx,
  userId: Id<"users">,
  perm: Permission,
): Promise<boolean> {
  const perms = await getEffectivePermissions(ctx, userId);
  return perms.has(perm);
}

/**
 * Assert the current user holds `perm`. Returns the user doc for convenience.
 * Spec §5.1 — the one helper every check goes through.
 */
export async function requirePermission(ctx: Ctx, perm: Permission): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  const perms = await getEffectivePermissions(ctx, user._id);
  if (!perms.has(perm)) throw new AppError("forbidden", `missing permission ${perm}`);
  return user;
}

/** Does this specific user currently hold a full-permission (server manager) role? */
export async function userIsFullPermission(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<boolean> {
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const a of assignments) {
    const role = await ctx.db.get(a.roleId);
    if (role && isFullPermissionSet(role.permissions)) return true;
  }
  return false;
}

/**
 * Count distinct members who currently hold at least one full-permission role.
 * Used by the last-admin guard (§5.1) — the system refuses any mutation that
 * would leave zero full-permission members.
 */
export async function countFullPermissionMembers(ctx: Ctx): Promise<number> {
  const roles = await ctx.db.query("roles").collect();
  const fullRoleIds = new Set(
    roles.filter((r) => isFullPermissionSet(r.permissions)).map((r) => r._id),
  );
  if (fullRoleIds.size === 0) return 0;

  const fullMembers = new Set<string>();
  for (const roleId of fullRoleIds) {
    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_role", (q) => q.eq("roleId", roleId as Id<"roles">))
      .collect();
    for (const a of assignments) {
      const u = await ctx.db.get(a.userId);
      if (u && u.status !== "inactive") fullMembers.add(a.userId);
    }
  }
  return fullMembers.size;
}

/**
 * Guard that the given mutation (applied via `wouldRemain`) keeps at least one
 * active full-permission member. Throws `last_admin_protected` otherwise.
 * `affectedUserId` is the member whose roles are about to change; the caller
 * computes whether they WOULD still be full-permission afterward.
 */
export async function assertNotLastAdminRemoval(
  ctx: MutationCtx,
  affectedUserId: Id<"users">,
  affectedWouldRemainFull: boolean,
): Promise<void> {
  if (affectedWouldRemainFull) return; // no reduction in admin coverage
  const wasFull = await userIsFullPermission(ctx, affectedUserId);
  if (!wasFull) return; // affected member wasn't an admin; coverage unchanged
  const remaining = await countFullPermissionMembers(ctx);
  // `remaining` still counts the affected member (change not yet applied), so a
  // value of 1 means they are the last one.
  if (remaining <= 1) throw new AppError("last_admin_protected");
}
