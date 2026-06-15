# Data model

Complete reference for the Convex schema (`convex/schema.ts`). Covers every table, its purpose, key fields, indexes, and invariants. The authoritative source is always the schema file itself; this document adds context the schema cannot express.

---

## `items`

The central entity. Every non-retired item is in exactly one member's care at all times.

| Field | Type | Notes |
|---|---|---|
| `title` | string | Display name |
| `description` | string | Free-text description |
| `categoryId` | id(categories) | Required; categories are a managed tree (depth ≤ 3) |
| `tags` | string[] | Freeform tags |
| `attributes` | {key, value}[] | Flexible key-value pairs (e.g. brand, color) |
| `state` | enum | See item state machine below |
| `custodianId` | id(users) | Denormalized truth-of-now; must match the current ledger state |
| `atBranchId` | id(branches)? | Set when the item is physically at a branch |
| `conditionRating` | number | 1–5 scale; updated on each handoff by the receiver |
| `primaryPhotoId` | id(_storage) | The photo shown in catalog listings |
| `ledgerSeq` | number | Current highest `seq` in the ledger for this item |
| `exchangePref` | enum | `reveal_contact` or `branch`; snapshot for the current listing |
| `contributedBy` | id(users) | Immutable after creation |
| `contributedAt` | number | Unix ms timestamp; immutable |
| `lastAvailableAt` | number | Denormalized for catalog sort (most recently available first) |
| `searchText` | string? | Denormalized `title + " " + description + " " + tags.join(" ")`; maintained on every write touching those fields; used by the Convex search index |
| `retiredAt` | number? | Set when state becomes `retired` |

**Indexes:**
- `by_state` — filter by state
- `by_custodian` — all items a user is looking after
- `by_category` — items in a category
- `by_branch` — items at a given branch
- `by_contributor` — items a member contributed
- `by_state_lastAvailable` — catalog default sort (available items, most recently available first)
- `by_lastAvailableAt` — global sort fallback
- `search_catalog` — Convex search index on `searchText`, filterable by `state`, `categoryId`, `conditionRating`, `atBranchId`

**Item state machine:**

```
contributed
    │
    ▼
available ◀──────────────────────────────────────────────┐
    │                                                      │
    │ claim created                                        │ claim cancelled / handoff cancelled
    ▼                                                      │
claimed ────────────────────────────────────────────────▶─┤
    │                                                      │
    │ handoff completed (both parties confirmed + photo)   │
    ▼                                                      │
in_custody ◀──── repair completed                         │
    │                                                      │
    │ repair claim created                                 │
    ▼                                                      │
under_repair                                               │
    │                                                      │
    │ claim cancelled during repair                        │
    └──────────────────────────────────────────────────────┘
    
in_custody / available / under_repair
    │
    │ retirement approved
    ▼
retired (terminal — no transitions out)
```

---

## `ledgerEntries`

Append-only event log. The only write path is `convex/lib/ledger.ts:appendLedger`. Never insert directly.

| Field | Type | Notes |
|---|---|---|
| `itemId` | id(items) | The item this entry belongs to |
| `seq` | number | Monotonically increasing per item; starts at 1 |
| `type` | enum | See ledger event types below |
| `actorId` | id(users) | Member who caused the event |
| `counterpartyId` | id(users)? | The other party (e.g. giver in a handoff) |
| `claimId` | id(claims)? | The claim that triggered this event |
| `conditionRating` | number? | Condition at this point in time |
| `note` | string? | Free-text note |
| `photoFileIds` | id(_storage)[] | Photos attached to this event |
| `branchId` | id(branches)? | Branch involved (for `placed_at_branch`, etc.) |
| `correctsSeq` | number? | For `annotation` type: the seq this entry clarifies |
| `reason` | string? | Cancellation reason, retirement reason, etc. |
| `createdAt` | number | Unix ms timestamp |

**Indexes:**
- `by_item_seq` — fetch an item's full history in order

**Ledger event types:**

| Type | When written |
|---|---|
| `contributed` | Item added to the catalog |
| `claimed` | A claim is opened |
| `claim_cancelled` | A claim is cancelled (by claimant, custodian, expiry, or admin) |
| `handoff_completed` | Two-party photo handoff finished; custody moved |
| `status_update` | Custodian logs a condition observation |
| `repair_started` | Repair claim confirmed |
| `repair_completed` | Repair finished; item back in circulation |
| `marked_available` | Custodian marks item available for claiming |
| `placed_at_branch` | Item physically deposited at a branch |
| `removed_from_branch` | Item picked up from a branch |
| `retirement_proposed` | Retirement proposal submitted |
| `retired` | Retirement approved; terminal event |
| `retirement_denied` | Proposal rejected |
| `admin_transfer` | Admin forced a custody change (no photo required) |
| `annotation` | Correction or clarifying note; `correctsSeq` points to the entry it supplements |

---

## `claims`

A member's declaration of intent to take custody of an item. At most one non-terminal claim per item at any time (enforced in `convex/claims.ts`).

| Field | Type | Notes |
|---|---|---|
| `itemId` | id(items) | The item being claimed |
| `claimantId` | id(users) | The member who opened the claim |
| `purpose` | `use` \| `repair` | Whether this is a standard claim or a repair checkout |
| `staging` | boolean | Whether the exchange will go through a branch staging step |
| `state` | enum | See claim state machine below |
| `exchangeMode` | `reveal_contact` \| `branch` | How the handoff is arranged |
| `branchId` | id(branches)? | Branch for branch-mode handoffs |
| `contactRevealed` | boolean | Whether contact details have been shown |
| `receiverPhotoIds` | id(_storage)[] | Photos taken by the receiver (required to complete) |
| `receiverCondition` | number? | Condition rating submitted by receiver |
| `giverConfirmedAt` | number? | Timestamp when giver confirmed |
| `receiverConfirmedAt` | number? | Timestamp when receiver confirmed |
| `expiresAt` | number | When this claim expires if not completed |
| `expiringNotifiedAt` | number? | When the ≤24h expiry warning was sent; prevents duplicate warnings |
| `createdAt` | number | Unix ms timestamp |

**Indexes:**
- `by_item` — claims on an item
- `by_claimant` — claims opened by a user
- `by_state` — filter by state
- `by_item_state` — active claim lookup (check for existing active claim)
- `by_expiresAt` — expiry sweep (all claims)
- `by_state_expiresAt` — expiry sweep bounded to `pending` only; prevents unbounded scan as completed claims accumulate

**Claim state machine:**

```
pending ──────────────────────────────────────────▶ cancelled
    │                                                  ▲
    │ giver confirms                                   │ (by claimant, giver, expiry, or admin)
    ▼                                                  │
giver_confirmed ────────────────────────────────────▶─┤
    │                                                  │
    │ receiver confirms (with photo)                   │
    ▼                                                  │
receiver_confirmed ─────────────────────────────────▶─┘
    │
    │ (system finalizes)
    ▼
completed (terminal)
```

Note: `receiver_confirmed` is an intermediate state that exists only briefly. After the receiver submits their photo and condition rating, the system automatically finalizes the claim and writes the `handoff_completed` ledger entry.

---

## `branches`

Member-hosted physical drop points.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `hostUserId` | id(users) | The member who hosts this branch |
| `description` | string | What the branch is |
| `locationText` | string | Human-readable address or description |
| `geo` | {lat, lng}? | Optional coordinates |
| `accessNotes` | string | How to access the branch |
| `photoFileIds` | id(_storage)[] | Photos of the branch |
| `status` | `active` \| `inactive` | Inactive branches remain in the record |

**Indexes:**
- `by_host` — branches hosted by a user

---

## `categories`

Managed tree of item categories. Depth ≤ 3 (root → subcategory → sub-subcategory). Enforced in `convex/categories.ts`.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `parentId` | id(categories)? | Null for root categories |
| `description` | string? | Optional description |
| `archived` | boolean | Archived categories are hidden from new contributions but preserved on existing items |

**Indexes:**
- `by_parent` — children of a category node

---

## `notifications`

In-app and email notification delivery.

| Field | Type | Notes |
|---|---|---|
| `userId` | id(users) | Recipient |
| `kind` | string | Notification type key (e.g. `claim.opened`, `handoff.completed`, `item.available`) |
| `payload` | any | Type-specific data (item name, claim ID, etc.) |
| `read` | boolean | Whether the member has seen it |
| `emailState` | enum? | `queued`, `sent`, `failed`, `skipped` — only set if an email was attempted |
| `createdAt` | number | Unix ms timestamp |

**Indexes:**
- `by_user_read` — unread notifications for a user (notification badge count)
- `by_user` — all notifications for a user

---

## `emailOutbox`

Write queue for outbound email. Written by mutations, drained by the `emailDrain` cron action. Doubles as the delivery log.

| Field | Type | Notes |
|---|---|---|
| `to` | string | Recipient address |
| `template` | string | Template name (maps to a function in `email.ts`) |
| `payload` | any | Template data |
| `state` | `queued` \| `sent` \| `failed` | Delivery state |
| `attempts` | number | How many send attempts have been made |
| `nextAttemptAt` | number | Earliest time to retry |
| `lastError` | string? | Most recent SMTP error message |
| `messageId` | string? | SMTP Message-ID (for inbound reply matching) |
| `claimId` | id(claims)? | Claim this email relates to (for reply threading) |
| `createdAt` | number | Unix ms timestamp |

**Indexes:**
- `by_state` — drain queued emails
- `by_messageId` — match inbound replies to outbound messages

---

## `emailInbound`

Record of every message fetched from the IMAP inbox.

| Field | Type | Notes |
|---|---|---|
| `imapUid` | number | IMAP UID; used for deduplication |
| `from` | string | Sender address |
| `subject` | string | Email subject |
| `inReplyTo` | string? | In-Reply-To header value |
| `matchedClaimId` | id(claims)? | Set if matched to a claim |
| `matchedUserId` | id(users)? | Set if matched to a member |
| `bodyText` | string | Plaintext body, capped at 32 KB |
| `disposition` | `logged` \| `bounce` \| `unmatched` | Classification result |
| `receivedAt` | number | Unix ms timestamp |

**Indexes:**
- `by_uid` — deduplication; prevents re-processing the same IMAP UID
- `by_claim` — replies linked to a claim

---

## `instanceSettings`

Singleton table (always exactly one row, created by the setup wizard).

| Field | Type | Notes |
|---|---|---|
| `orgName` | string | Organization name |
| `claimExpiryHours` | number | Default claim TTL in hours |
| `twoFactorPolicy` | `required` \| `off` | Whether 2FA is mandatory for all members or just full-permission accounts |
| `smtp` | smtpConfig? | SMTP credentials (password encrypted with APP_SECRETS_KEY) |
| `imap` | imapConfig? | IMAP credentials (password encrypted) |
| `branchesEnabled` | boolean | Whether branch functionality is visible |
| `photoMaxEdgePx` | number | Maximum photo dimension in pixels |
| `accentColor` | string? | Org accent color hex |
| `setupCompleted` | boolean | False while the setup wizard has not been submitted; controls setup route visibility |

---

## `users`

Augments Convex Auth's `authTables.users`. Fields are optional because Convex Auth may insert a minimal row during sign-up before the app sets full details.

| Field | Type | Notes |
|---|---|---|
| `name` | string? | Display name |
| `email` | string? | Email address |
| `emailVerificationTime` | number? | When email was verified |
| `avatarFileId` | id(_storage)? | Avatar photo |
| `status` | enum? | `invited`, `active`, `inactive` |
| `contactPhone` | string? | Phone (revealed during active handoffs) |
| `defaultExchangePref` | enum? | Member's preferred handoff mode |
| `notificationPref` | `in_app` \| `email`? | Delivery preference |
| `createdAt` | number? | Unix ms timestamp |

**Index:**
- `email` — named exactly `"email"` (required by Convex Auth for account linking)

---

## `roles` / `roleAssignments`

Roles store a named set of permission strings. Assignments map users to roles (many-to-many).

`roles` fields: `name`, `description`, `permissions` (string[]), `isSystemDefault` (boolean).

`roleAssignments` fields: `userId`, `roleId`.

System default roles (created by setup wizard): `server-manager`, `admin`, `member`. The `server-manager` role cannot be left with zero members.

---

## Auth / 2FA support tables

| Table | Purpose |
|---|---|
| `mfaPending` | Short-lived tokens issued after password verification; exchanged for a session only after 2FA passes |
| `twoFactor` | Per-user 2FA enrollment (TOTP secret, recovery code hashes) |
| `emailOtp` | Email OTP challenges (code hash, expiry, lockout after 5 wrong attempts) |
| `invites` | Single-use invite tokens (72 h TTL); link pre-created user row to an email address |
| `rateLimits` | Per-account and per-IP counters for auth endpoints |

---

## `auditEvents`

Cross-item feed of sensitive administrative actions (role changes, admin transfers, settings updates). Written by admin-level mutations, visible in Admin → Audit feed.

| Field | Type | Notes |
|---|---|---|
| `actorId` | id(users)? | Admin who performed the action (null for system) |
| `action` | string | Event type key, e.g. `"role.assign"`, `"admin_transfer"`, `"settings.update"` |
| `targetId` | string? | ID of the affected entity |
| `detail` | any | Structured event detail |
| `createdAt` | number | Unix ms timestamp |

**Index:**
- `by_createdAt` — reverse-chronological audit feed

---

## `watches`

User's watch list for items. Exactly one row per (user, item) pair, enforced in `convex/watches.ts`.

| Field | Type | Notes |
|---|---|---|
| `userId` | id(users) | Watcher |
| `itemId` | id(items) | Item being watched |
| `createdAt` | number | Unix ms timestamp |

**Indexes:**
- `by_user` — all watches for a user
- `by_item` — all watchers for an item
- `by_user_item` — existence check / uniqueness enforcement
