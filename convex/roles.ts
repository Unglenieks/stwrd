// Roles & permissions engine (spec §5, §22.2 roles.*).
//
// A role is just { name, description, permissions[] }. The catalog is closed
// (§5.2) so unknown keys are rejected. The last-admin guard (§5.1) refuses any
// change leaving zero active full-permission members.
import { v } from "convex/values";
import {
  ALL_PERMISSIONS,
  AppError,
  isFullPermissionSet,
  isPermission,
  MEMBER_PERMISSIONS,
  PERMISSIONS,
} from "@stwrd/shared";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { recordAudit } from "./lib/instance";
import {
  assertNotLastAdminRemoval,
  currentUserId,
  getEffectivePermissions,
  requirePermission,
} from "./lib/permissions";

/** List all roles (with member counts) for the role builder (§15). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.rolesManage);
    const roles = await ctx.db.query("roles").collect();
    return Promise.all(
      roles.map(async (r) => {
        const assignments = await ctx.db
          .query("roleAssignments")
          .withIndex("by_role", (q) => q.eq("roleId", r._id))
          .collect();
        return {
          _id: r._id,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          isSystemDefault: r.isSystemDefault,
          isFullPermission: isFullPermissionSet(r.permissions),
          memberCount: assignments.length,
        };
      }),
    );
  },
});

/** The full permission catalog for the role-builder checkbox grid. */
export const catalog = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, PERMISSIONS.rolesManage);
    return ALL_PERMISSIONS;
  },
});

function validatePermissions(permissions: string[]): void {
  const seen = new Set<string>();
  for (const p of permissions) {
    if (!isPermission(p)) throw new AppError("validation_failed", `unknown permission ${p}`);
    seen.add(p);
  }
  // Dedupe in place is the caller's job; we just validate keys here.
}

/** Create or edit a role. Editing a role that downgrades the last admin is blocked. */
export const upsert = mutation({
  args: {
    roleId: v.optional(v.id("roles")),
    name: v.string(),
    description: v.string(),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.rolesManage);
    validatePermissions(args.permissions);
    const permissions = [...new Set(args.permissions)];

    if (args.roleId) {
      const existing = await ctx.db.get(args.roleId);
      if (!existing) throw new AppError("not_found");

      // If this edit removes full-permission status from a role, ensure no
      // current holder becomes the last admin to lose it (§5.1).
      const wasFull = isFullPermissionSet(existing.permissions);
      const willBeFull = isFullPermissionSet(permissions);
      if (wasFull && !willBeFull) {
        const holders = await ctx.db
          .query("roleAssignments")
          .withIndex("by_role", (q) => q.eq("roleId", existing._id))
          .collect();
        for (const h of holders) {
          await assertNotLastAdminRemovalForRoleEdit(ctx, h.userId, existing._id);
        }
      }

      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        permissions,
      });
      await recordAudit(ctx, {
        actorId: actor._id,
        action: "role.update",
        targetId: existing._id,
        detail: { name: args.name, permissions },
      });
      return existing._id;
    }

    const id = await ctx.db.insert("roles", {
      name: args.name,
      description: args.description,
      permissions,
      isSystemDefault: false,
    });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "role.create",
      targetId: id,
      detail: { name: args.name, permissions },
    });
    return id;
  },
});

/**
 * Whether a member would still hold a full-permission role if `excludingRoleId`
 * no longer counted as full. Used when a role edit removes admin status.
 */
async function assertNotLastAdminRemovalForRoleEdit(
  ctx: MutationCtx,
  userId: Id<"users">,
  excludingRoleId: Id<"roles">,
): Promise<void> {
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let stillFull = false;
  for (const a of assignments) {
    if (a.roleId === excludingRoleId) continue;
    const role = await ctx.db.get(a.roleId);
    if (role && isFullPermissionSet(role.permissions)) {
      stillFull = true;
      break;
    }
  }
  await assertNotLastAdminRemoval(ctx, userId, stillFull);
}

/** Assign or remove a role for a member. Guards the last full-permission member. */
export const assign = mutation({
  args: {
    userId: v.id("users"),
    roleId: v.id("roles"),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(ctx, PERMISSIONS.rolesManage);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new AppError("not_found");
    const role = await ctx.db.get(args.roleId);
    if (!role) throw new AppError("not_found");

    const existing = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user_role", (q) =>
        q.eq("userId", args.userId).eq("roleId", args.roleId),
      )
      .first();

    if (args.remove) {
      if (!existing) return; // idempotent
      // Would removing this role drop the member below full-permission?
      const wouldRemainFull = await wouldRemainFullWithout(ctx, args.userId, args.roleId);
      await assertNotLastAdminRemoval(ctx, args.userId, wouldRemainFull);
      await ctx.db.delete(existing._id);
      await recordAudit(ctx, {
        actorId: actor._id,
        action: "role.unassign",
        targetId: args.userId,
        detail: { roleId: args.roleId, roleName: role.name },
      });
      return;
    }

    if (existing) return; // already assigned, idempotent
    await ctx.db.insert("roleAssignments", { userId: args.userId, roleId: args.roleId });
    await recordAudit(ctx, {
      actorId: actor._id,
      action: "role.assign",
      targetId: args.userId,
      detail: { roleId: args.roleId, roleName: role.name },
    });
  },
});

async function wouldRemainFullWithout(
  ctx: MutationCtx,
  userId: Id<"users">,
  removingRoleId: Id<"roles">,
): Promise<boolean> {
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const a of assignments) {
    if (a.roleId === removingRoleId) continue;
    const role = await ctx.db.get(a.roleId);
    if (role && isFullPermissionSet(role.permissions)) return true;
  }
  return false;
}

/**
 * Seed the two default roles (Server Manager = all permissions, Member =
 * baseline ✦). Idempotent; called from the setup wizard (§6.3). Returns the
 * two role ids.
 */
export async function seedDefaultRoles(
  ctx: MutationCtx,
): Promise<{ serverManagerRoleId: Id<"roles">; memberRoleId: Id<"roles"> }> {
  const existing = await ctx.db.query("roles").collect();
  let serverManager = existing.find((r) => isFullPermissionSet(r.permissions));
  let member = existing.find((r) => r.isSystemDefault && !isFullPermissionSet(r.permissions));

  let serverManagerRoleId: Id<"roles">;
  if (serverManager) {
    serverManagerRoleId = serverManager._id;
  } else {
    serverManagerRoleId = await ctx.db.insert("roles", {
      name: "Server Manager",
      description: "Full access to every part of the instance.",
      permissions: [...ALL_PERMISSIONS],
      isSystemDefault: true,
    });
  }

  let memberRoleId: Id<"roles">;
  if (member) {
    memberRoleId = member._id;
  } else {
    memberRoleId = await ctx.db.insert("roles", {
      name: "Member",
      description: "The baseline circulation set, assigned to every new account.",
      permissions: [...MEMBER_PERMISSIONS],
      isSystemDefault: true,
    });
  }

  return { serverManagerRoleId, memberRoleId };
}

/** The effective permissions of the current user, for UI affordance gating (§5.1). */
export const myPermissions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    return [...(await getEffectivePermissions(ctx, userId))];
  },
});
