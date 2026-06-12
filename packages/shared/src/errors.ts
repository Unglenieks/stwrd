/**
 * Closed error-code enum — spec §22.5.
 *
 * Every mutation failure maps to EXACTLY ONE of these codes. User-facing
 * message strings live in the frontend (a single i18n-ready map keyed by code),
 * so backend implementations never invent copy — they only throw a code.
 */

export const ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "rate_limited",
  "item_not_available",
  "self_claim_forbidden",
  "claim_not_pending",
  "claim_wrong_party",
  "photo_required",
  "state_conflict",
  "branch_has_items",
  "last_admin_protected",
  "smtp_unconfigured",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET = new Set<string>(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODE_SET.has(value);
}

/**
 * The canonical application error. Convex functions throw this; the `code` is
 * the contract, the optional `detail` is for logs/debugging only (never shown
 * to users verbatim — the frontend renders copy from `code`).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }
}

/** Convenience throwers — read naturally at call sites. */
export const fail = (code: ErrorCode, detail?: string): never => {
  throw new AppError(code, detail);
};

export function assert(condition: unknown, code: ErrorCode, detail?: string): asserts condition {
  if (!condition) throw new AppError(code, detail);
}

/**
 * Default English copy keyed by code. The frontend owns the authoritative map;
 * this is provided as the canonical fallback so the two never drift on meaning.
 * Spec §22.5.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "You need to sign in to do that.",
  forbidden: "You don't have permission to do that.",
  not_found: "That item could no longer be found.",
  validation_failed: "Some of the details you entered aren't valid.",
  rate_limited: "Too many attempts. Please wait a bit and try again.",
  item_not_available: "Someone just claimed this — you missed it by a moment.",
  self_claim_forbidden: "You can't claim an item you already hold.",
  claim_not_pending: "This claim is no longer active.",
  claim_wrong_party: "Only the giver or receiver can confirm this handoff.",
  photo_required: "Add at least one photo of the item to confirm.",
  state_conflict: "That action isn't available for this item right now.",
  branch_has_items: "Move or hand off the items at this branch before deactivating it.",
  last_admin_protected: "The instance must always keep at least one full-permission member.",
  smtp_unconfigured: "Email isn't configured yet — ask your server manager.",
};
