/**
 * Permission catalog — spec §5.2.
 *
 * The catalog is CLOSED and versioned in code. Orgs compose roles from these
 * keys but cannot invent new ones — this keeps server-side checks exhaustive
 * and testable. Every permission check happens server-side via a single
 * `requirePermission(ctx, perm)` helper; UI gating is cosmetic only (§5.1).
 */

export const PERMISSIONS = {
  itemsContribute: "items.contribute",
  itemsClaim: "items.claim",
  itemsUpdateOwn: "items.update_own",
  itemsEditAny: "items.edit_any",
  itemsRetirePropose: "items.retire_propose",
  itemsRetireApprove: "items.retire_approve",
  itemsLedgerAnnotate: "items.ledger_annotate",
  categoriesManage: "categories.manage",
  branchesCreate: "branches.create",
  branchesManageAny: "branches.manage_any",
  usersCreate: "users.create",
  usersManage: "users.manage",
  rolesManage: "roles.manage",
  claimsManageAny: "claims.manage_any",
  instanceSettings: "instance.settings",
  instanceAuditView: "instance.audit_view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** The complete closed set, in catalog order (§5.2). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** Type guard: is a raw string a valid catalog permission key? */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * The baseline circulation set assigned automatically to new accounts —
 * the "Member" default role (marked ✦ in §5.2).
 *
 * Note: `branches.create` is ✦* — included by default, but orgs that don't
 * want branches remove it from the Member role (the "if an org chooses" switch).
 */
export const MEMBER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.itemsContribute,
  PERMISSIONS.itemsClaim,
  PERMISSIONS.itemsUpdateOwn,
  PERMISSIONS.itemsRetirePropose,
  PERMISSIONS.branchesCreate,
];

/** Human-readable descriptions for the role-builder UI (§15 Roles panel). */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [PERMISSIONS.itemsContribute]: "Add new items to the catalog.",
  [PERMISSIONS.itemsClaim]: "Claim available items and complete handoffs.",
  [PERMISSIONS.itemsUpdateOwn]: "Edit details / add status & repair notes on items in own custody.",
  [PERMISSIONS.itemsEditAny]: "Edit metadata of any item (typo fixes, recategorization).",
  [PERMISSIONS.itemsRetirePropose]: "Propose retirement of an item in own custody.",
  [PERMISSIONS.itemsRetireApprove]: "Approve/deny retirement proposals.",
  [PERMISSIONS.itemsLedgerAnnotate]: "Append correction/annotation entries to any item's ledger.",
  [PERMISSIONS.categoriesManage]: "Create/edit/merge/archive categories and curate the tag namespace.",
  [PERMISSIONS.branchesCreate]: "Register a branch at one's own property.",
  [PERMISSIONS.branchesManageAny]: "Edit/deactivate any branch.",
  [PERMISSIONS.usersCreate]: "Provision member accounts and send invites.",
  [PERMISSIONS.usersManage]: "Deactivate/reactivate accounts, reset credentials, edit profiles.",
  [PERMISSIONS.rolesManage]: "Create/edit roles and assign them to members.",
  [PERMISSIONS.claimsManageAny]: "Cancel any pending claim; force-complete or force-cancel stuck handoffs.",
  [PERMISSIONS.instanceSettings]: "Edit org settings: SMTP/IMAP, claim expiry, branding, photo retention.",
  [PERMISSIONS.instanceAuditView]: "View the cross-item admin audit feed and email delivery log.",
};

/**
 * Does a permission set constitute a "full-permission" (server manager) role?
 * The system must always keep at least one member holding all permissions (§5.1).
 */
export function isFullPermissionSet(perms: readonly string[]): boolean {
  const held = new Set(perms);
  return ALL_PERMISSIONS.every((p) => held.has(p));
}
