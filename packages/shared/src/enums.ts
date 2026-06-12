/**
 * Shared enums — the closed value sets referenced by both the Convex schema
 * validators and the frontend. Spec §7, §8, §9.
 */

/** Item lifecycle states. Spec §7.3, §8.1. */
export const ITEM_STATES = [
  "available",
  "claimed",
  "in_custody",
  "under_repair",
  "retired",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** User account status. Spec §7.1. */
export const USER_STATES = ["invited", "active", "inactive"] as const;
export type UserState = (typeof USER_STATES)[number];

/** Exchange mode for a listing / claim. Spec §7.5, §9.1. */
export const EXCHANGE_MODES = ["reveal_contact", "branch"] as const;
export type ExchangeMode = (typeof EXCHANGE_MODES)[number];

/** A member's default exchange preference (null = unset). Spec §7.1. */
export const EXCHANGE_PREFS = ["reveal_contact", "branch"] as const;
export type ExchangePref = (typeof EXCHANGE_PREFS)[number];

/** Claim purpose — use vs. repair. Spec §7.5, §9.1. */
export const CLAIM_PURPOSES = ["use", "repair"] as const;
export type ClaimPurpose = (typeof CLAIM_PURPOSES)[number];

/** Claim state machine. Spec §7.5. */
export const CLAIM_STATES = [
  "pending",
  "giver_confirmed",
  "receiver_confirmed",
  "completed",
  "cancelled",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** Reasons recorded on `claim_cancelled` ledger entries. Spec §7.4, §9.3. */
export const CLAIM_CANCEL_REASONS = ["expired", "by_holder", "by_claimant", "admin"] as const;
export type ClaimCancelReason = (typeof CLAIM_CANCEL_REASONS)[number];

/** Ledger entry types — the full closed set. Spec §7.4. */
export const LEDGER_ENTRY_TYPES = [
  "contributed",
  "claimed",
  "claim_cancelled",
  "handoff_completed",
  "status_update",
  "repair_started",
  "repair_completed",
  "marked_available",
  "placed_at_branch",
  "removed_from_branch",
  "retirement_proposed",
  "retired",
  "retirement_denied",
  "admin_transfer",
  "annotation",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** Branch status. Spec §7.6. */
export const BRANCH_STATES = ["active", "inactive"] as const;
export type BranchState = (typeof BRANCH_STATES)[number];

/** Org 2FA policy. Spec §6.2, §7.10. */
export const TWO_FACTOR_POLICIES = ["required", "off"] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

/** Per-user notification preference (single toggle — no per-kind matrix in v1). Spec §14. */
export const NOTIFICATION_PREFS = ["in_app", "email"] as const;
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number];

/** Notification kinds. Spec §14, §23.5. */
export const NOTIFICATION_KINDS = [
  "claim_placed",
  "claim_cancelled",
  "claim_expiring",
  "watched_item_available",
  "handoff_confirmed_by_other",
  "handoff_completed",
  "inbound_reply",
  "retirement_decision",
  "branch_item_placed",
  "security_alert",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Email delivery (outbox) state. Spec §7.9. */
export const EMAIL_OUTBOX_STATES = ["queued", "sent", "failed"] as const;
export type EmailOutboxState = (typeof EMAIL_OUTBOX_STATES)[number];

/** Per-notification email delivery state. Spec §7.8. */
export const NOTIFICATION_EMAIL_STATES = ["queued", "sent", "failed", "skipped"] as const;
export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number];

/** Inbound email disposition. Spec §7.9, §13. */
export const INBOUND_DISPOSITIONS = ["logged", "bounce", "unmatched"] as const;
export type InboundDisposition = (typeof INBOUND_DISPOSITIONS)[number];

/** Email template ids — subject lines are normative in §23.4. */
export const EMAIL_TEMPLATES = [
  "invite",
  "otp",
  "claim_placed",
  "claim_cancelled",
  "claim_expiring",
  "handoff_completed",
  "watched_item_available",
  "retirement_decision",
  "branch_item_placed",
  "security_alert",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/**
 * Condition rubric — normative wording shown at each 1–5 slider stop. Spec §20.
 * The receiver's rating is authoritative going forward (§20.3).
 */
export const CONDITION_RUBRIC: Record<number, { label: string; detail: string }> = {
  5: { label: "Like new", detail: "no visible wear" },
  4: { label: "Good", detail: "minor cosmetic wear, fully functional" },
  3: { label: "Usable", detail: "worn; works, quirks noted" },
  2: { label: "Needs repair", detail: "not reliably usable as-is" },
  1: { label: "Not usable", detail: "parts / repair project" },
};
