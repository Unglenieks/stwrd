/**
 * Convex schema — spec §7.
 *
 * Validators are the server-side enforcement of the data model. Enum value sets
 * mirror `@stwrd/shared/enums`; where Convex needs literal unions we spell them
 * out here and keep them in lockstep with the shared enums (the shared package
 * is the source the frontend reads; this file is what the database enforces).
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const itemState = v.union(
  v.literal("available"),
  v.literal("claimed"),
  v.literal("in_custody"),
  v.literal("under_repair"),
  v.literal("retired"),
);

const exchangeMode = v.union(v.literal("reveal_contact"), v.literal("branch"));

const ledgerType = v.union(
  v.literal("contributed"),
  v.literal("claimed"),
  v.literal("claim_cancelled"),
  v.literal("handoff_completed"),
  v.literal("status_update"),
  v.literal("repair_started"),
  v.literal("repair_completed"),
  v.literal("marked_available"),
  v.literal("placed_at_branch"),
  v.literal("removed_from_branch"),
  v.literal("retirement_proposed"),
  v.literal("retired"),
  v.literal("retirement_denied"),
  v.literal("admin_transfer"),
  v.literal("annotation"),
);

const claimState = v.union(
  v.literal("pending"),
  v.literal("giver_confirmed"),
  v.literal("receiver_confirmed"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const encryptedSecret = v.object({
  ciphertext: v.string(),
  iv: v.string(),
  tag: v.string(),
});

const smtpConfig = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
  username: v.string(),
  // Password stored encrypted with APP_SECRETS_KEY (§7.10, §18.1).
  passwordEnc: encryptedSecret,
  fromAddress: v.string(),
  replyToDomain: v.optional(v.string()),
});

const imapConfig = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
  username: v.string(),
  passwordEnc: encryptedSecret,
});

export default defineSchema({
  // Convex Auth's own tables (authAccounts, authSessions, etc.). Spec §7.1.
  ...authTables,

  // §7.1 — application user profile (auth credentials live in authTables).
  // This OVERRIDES authTables.users with our augmented shape. Convex Auth's
  // Password provider may insert a row with only {email, name} during sign-up,
  // so the app-managed fields are optional and defaulted by our setup/invite
  // code (the canonical creation paths). Treat a missing field as its default.
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    avatarFileId: v.optional(v.id("_storage")),
    status: v.optional(
      v.union(v.literal("invited"), v.literal("active"), v.literal("inactive")),
    ),
    contactPhone: v.optional(v.string()),
    defaultExchangePref: v.optional(
      v.union(v.literal("reveal_contact"), v.literal("branch"), v.null()),
    ),
    notificationPref: v.optional(v.union(v.literal("in_app"), v.literal("email"))),
    createdAt: v.optional(v.number()),
    // Index MUST be named "email" — @convex-dev/auth's account-linking looks up
    // users by an index of that exact name (uniqueUserWithVerifiedEmail).
  }).index("email", ["email"]),

  // §7.2 — roles & assignments.
  roles: defineTable({
    name: v.string(),
    description: v.string(),
    permissions: v.array(v.string()),
    isSystemDefault: v.boolean(),
  }).index("by_name", ["name"]),

  roleAssignments: defineTable({
    userId: v.id("users"),
    roleId: v.id("roles"),
  })
    .index("by_user", ["userId"])
    .index("by_role", ["roleId"])
    .index("by_user_role", ["userId", "roleId"]),

  // §7.3 — items. custodianId is denormalized truth-of-now; ledger is truth-of-history.
  items: defineTable({
    title: v.string(),
    description: v.string(),
    categoryId: v.id("categories"),
    tags: v.array(v.string()),
    attributes: v.array(v.object({ key: v.string(), value: v.string() })),
    state: itemState,
    custodianId: v.id("users"),
    atBranchId: v.optional(v.id("branches")),
    conditionRating: v.number(), // 1–5
    primaryPhotoId: v.id("_storage"),
    ledgerSeq: v.number(),
    exchangePref: v.union(v.literal("reveal_contact"), v.literal("branch")), // snapshot for current listing
    contributedBy: v.id("users"),
    contributedAt: v.number(),
    // Denormalized for default catalog sort (most recently AVAILABLE first, §17).
    lastAvailableAt: v.number(),
    // Denormalized title + description + tags for full-text catalog search (§17).
    // A Convex search index covers a single field; this is maintained on every
    // write that touches title/description/tags. Optional for schema evolution.
    searchText: v.optional(v.string()),
    retiredAt: v.optional(v.number()),
  })
    .index("by_state", ["state"])
    .index("by_custodian", ["custodianId"])
    .index("by_category", ["categoryId"])
    .index("by_branch", ["atBranchId"])
    .index("by_contributor", ["contributedBy"])
    .index("by_state_lastAvailable", ["state", "lastAvailableAt"])
    .index("by_lastAvailableAt", ["lastAvailableAt"])
    .searchIndex("search_catalog", {
      searchField: "searchText",
      filterFields: ["state", "categoryId", "conditionRating", "atBranchId"],
    }),

  // §7.4 — ledgerEntries. Append-only; the only write is insert.
  ledgerEntries: defineTable({
    itemId: v.id("items"),
    seq: v.number(),
    type: ledgerType,
    actorId: v.id("users"),
    counterpartyId: v.optional(v.id("users")),
    claimId: v.optional(v.id("claims")),
    conditionRating: v.optional(v.number()),
    note: v.optional(v.string()),
    photoFileIds: v.array(v.id("_storage")),
    branchId: v.optional(v.id("branches")),
    // For `annotation`: the seq this entry corrects (§7.4).
    correctsSeq: v.optional(v.number()),
    reason: v.optional(v.string()), // claim_cancelled reason enum, retirement reason, etc.
    createdAt: v.number(),
  }).index("by_item_seq", ["itemId", "seq"]),

  // §7.5 — claims. At most one non-terminal claim per item (enforced in mutation).
  claims: defineTable({
    itemId: v.id("items"),
    claimantId: v.id("users"),
    purpose: v.union(v.literal("use"), v.literal("repair")),
    staging: v.boolean(),
    state: claimState,
    exchangeMode,
    branchId: v.optional(v.id("branches")),
    contactRevealed: v.boolean(),
    receiverPhotoIds: v.array(v.id("_storage")),
    receiverCondition: v.optional(v.number()),
    giverConfirmedAt: v.optional(v.number()),
    receiverConfirmedAt: v.optional(v.number()),
    expiresAt: v.number(),
    // Set when the once-per-claim "expiring in ≤24h" warning has been sent (§23.1).
    expiringNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_item", ["itemId"])
    .index("by_claimant", ["claimantId"])
    .index("by_state", ["state"])
    .index("by_item_state", ["itemId", "state"])
    .index("by_expiresAt", ["expiresAt"])
    // Bounds the expiry sweeps to PENDING claims only (terminal claims keep an
    // expiresAt in the past forever, so a plain expiresAt scan would grow
    // unbounded over time). §9.3, §23.2.
    .index("by_state_expiresAt", ["state", "expiresAt"]),

  // §7.6 — branches.
  branches: defineTable({
    name: v.string(),
    hostUserId: v.id("users"),
    description: v.string(),
    locationText: v.string(),
    geo: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    accessNotes: v.string(),
    photoFileIds: v.array(v.id("_storage")),
    status: v.union(v.literal("active"), v.literal("inactive")),
  }).index("by_host", ["hostUserId"]),

  // §7.7 — categories: a managed tree, depth <= 3.
  categories: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    archived: v.boolean(),
  }).index("by_parent", ["parentId"]),

  // §7.8 — notifications.
  notifications: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    payload: v.any(),
    read: v.boolean(),
    emailState: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_user_read", ["userId", "read"])
    .index("by_user", ["userId"]),

  // §7.9 — emailOutbox (written by mutations, drained by an action; doubles as delivery log).
  emailOutbox: defineTable({
    to: v.string(),
    template: v.string(),
    payload: v.any(),
    state: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    messageId: v.optional(v.string()),
    // Matching key for inbound replies (claim plus-address / [STWRD#id] token, §13).
    claimId: v.optional(v.id("claims")),
    createdAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_messageId", ["messageId"]),

  // §7.9 — emailInbound.
  emailInbound: defineTable({
    imapUid: v.number(),
    from: v.string(),
    subject: v.string(),
    inReplyTo: v.optional(v.string()),
    matchedClaimId: v.optional(v.id("claims")),
    matchedUserId: v.optional(v.id("users")),
    bodyText: v.string(), // plaintext only, capped 32 KB (§13)
    disposition: v.union(v.literal("logged"), v.literal("bounce"), v.literal("unmatched")),
    receivedAt: v.number(),
  })
    .index("by_uid", ["imapUid"])
    .index("by_claim", ["matchedClaimId"]),

  // §7.10 — instanceSettings singleton.
  instanceSettings: defineTable({
    orgName: v.string(),
    claimExpiryHours: v.number(),
    twoFactorPolicy: v.union(v.literal("required"), v.literal("off")),
    smtp: v.optional(smtpConfig),
    imap: v.optional(imapConfig),
    branchesEnabled: v.boolean(),
    photoMaxEdgePx: v.number(),
    accentColor: v.optional(v.string()),
    setupCompleted: v.boolean(),
  }),

  // §7.11 — watches. Unique per (user, item), enforced in the mutation.
  watches: defineTable({
    userId: v.id("users"),
    itemId: v.id("items"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_item", ["itemId"])
    .index("by_user_item", ["userId", "itemId"]),

  // ── Auth/2FA support tables (our second-factor stack, §6.2) ────────────────

  // Short-lived single-use mfa_pending tokens issued after the password phase.
  // `secondFactorSatisfied` flips true once the required factor passes (or
  // immediately when no second factor is required); only then can the token be
  // exchanged for a session via the credentials provider's authorize (§6.2).
  mfaPending: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    consumed: v.boolean(),
    secondFactorSatisfied: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),

  // Per-user second-factor enrollment.
  twoFactor: defineTable({
    userId: v.id("users"),
    totpSecretEnc: v.optional(encryptedSecret), // encrypted with APP_SECRETS_KEY
    totpEnabledAt: v.optional(v.number()),
    recoveryCodeHashes: v.array(v.string()), // hashed, single-use
  }).index("by_user", ["userId"]),

  // Email OTP challenges tied to a pending login.
  emailOtp: defineTable({
    userId: v.id("users"),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    lockedUntil: v.optional(v.number()),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Invite tokens (§6.1). Single-use, 72 h TTL.
  invites: defineTable({
    email: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    userId: v.id("users"),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"]),

  // Per-account & per-IP rate-limit counters for auth endpoints (§18.1).
  rateLimits: defineTable({
    key: v.string(), // e.g. "login:ip:1.2.3.4" or "otp:user:<id>"
    count: v.number(),
    windowStartedAt: v.number(),
    lockedUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // Cross-item audit feed of sensitive events (§15 Audit & email).
  auditEvents: defineTable({
    actorId: v.optional(v.id("users")),
    action: v.string(), // e.g. "role.assign", "admin_transfer", "settings.update"
    targetId: v.optional(v.string()),
    detail: v.any(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});
