/**
 * Normative constants — spec §23.1.
 *
 * This file is the SINGLE SOURCE for every limit and default in the system.
 * Both the frontend and the Convex validators import from here; no inline
 * literals are permitted elsewhere. Changing a value here changes it everywhere.
 */

/** Invite link time-to-live. Spec §6.1, §23.1. */
export const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 h

/** `mfa_pending` token: short-lived, single-use. Spec §6.2, §23.1. */
export const MFA_PENDING_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 min

/** Email OTP parameters. Spec §6.2, §23.1. */
export const EMAIL_OTP_DIGITS = 6;
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000; // 10 min
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
export const EMAIL_OTP_LOCKOUT_MS = 15 * 60 * 1000; // 15-min lockout after max attempts

/** TOTP tolerance — ±1 time step. Spec §6.2. */
export const TOTP_STEP_TOLERANCE = 1;

/** Recovery codes: 10 generated, single-use, hashed; regeneration voids prior set. Spec §23.1. */
export const RECOVERY_CODE_COUNT = 10;

/** Session: 30-day rolling expiry. Spec §6.2, §23.1. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Password policy: min 10 chars AND zxcvbn score >= 3. Spec §23.1. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MIN_ZXCVBN_SCORE = 3;

/** Claim expiry window (hours). Default 168 (7 days); org-configurable 24–720. Spec §9.3, §23.1. */
export const CLAIM_EXPIRY_HOURS_DEFAULT = 168;
export const CLAIM_EXPIRY_HOURS_MIN = 24;
export const CLAIM_EXPIRY_HOURS_MAX = 720;

/** Claim-expiring warning fires once per claim at <= 24 h remaining. Spec §23.1. */
export const CLAIM_EXPIRING_WARN_HOURS = 24;

/** Pagination page sizes. Spec §17, §23.1. */
export const PAGE_SIZE_CATALOG = 24;
export const PAGE_SIZE_LEDGER = 50;
export const PAGE_SIZE_ADMIN = 50;

/** Text length limits (characters). Spec §23.1. */
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 5_000;
export const NOTE_MAX = 2_000;

/** Tag limits. Spec §7.7, §23.1. */
export const TAGS_MAX_PER_ITEM = 10;
export const TAG_MAX_LENGTH = 32;

/** Structured attribute limits. Spec §23.1. */
export const ATTRIBUTES_MAX_PAIRS = 20;
export const ATTRIBUTE_KEY_MAX = 40;
export const ATTRIBUTE_VALUE_MAX = 200;

/** Photo limits. Spec §18.2, §23.1. */
export const PHOTOS_MAX_PER_ENTRY = 10;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard server reject
export const PHOTO_MAX_EDGE_PX_DEFAULT = 2048;
/** Client target re-encode ceiling before upload (~500 KB). Spec §18.2. */
export const PHOTO_TARGET_BYTES = 500 * 1024;

/** Category tree max depth. Spec §7.7, §23.1. */
export const CATEGORY_MAX_DEPTH = 3;

/** Condition rating bounds. Spec §20.3. */
export const CONDITION_MIN = 1;
export const CONDITION_MAX = 5;

/** Email outbox retry policy. Spec §13, §23.1. */
export const OUTBOX_MAX_ATTEMPTS = 3;
export const OUTBOX_BACKOFF_MS = [1 * 60 * 1000, 10 * 60 * 1000, 60 * 60 * 1000] as const; // 1m / 10m / 60m

/** Inbound email body cap — plaintext only. Spec §13, §23.1. */
export const INBOUND_BODY_MAX_BYTES = 32 * 1024; // 32 KB

/** Excerpt length for inbound_reply notification payload. Spec §23.5. */
export const INBOUND_REPLY_EXCERPT_MAX = 200;
