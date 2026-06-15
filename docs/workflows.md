# Workflows

Key business flows, state machines, and the mutations that drive them. Cross-reference with `docs/data-model.md` for table structures and `convex/claims.ts`, `convex/items.ts`, etc. for the implementation.

---

## Item contribution

**File:** `convex/items.ts:contribute`

1. Member submits the contribution form (title, description, category, condition, photos, exchange preference, tags, attributes).
2. Frontend uploads the primary photo to Convex file storage via `storage.generateUploadUrl` + direct POST to HTTP action (`:3211`). The HTTP action strips EXIF/GPS metadata before storing. Returns a `_storage` ID.
3. `items.contribute` mutation:
   - Validates the photo ID exists in storage
   - Creates the `items` row with `state: "available"`, `custodianId: memberId`, `contributedBy: memberId`
   - Appends a `contributed` ledger entry via `lib/ledger.ts:appendLedger`
   - Sets `searchText` to `title + " " + description + " " + tags.join(" ")`
4. Item is immediately visible in the catalog.

Permission required: `items.contribute`.

---

## Claim lifecycle

**File:** `convex/claims.ts`

### Open a claim

Mutation: `claims.openClaim`

1. Member clicks "Take it into your care" on an available item.
2. Mutation checks: item must be `available`; no existing active claim on this item (state in `pending`, `giver_confirmed`, `receiver_confirmed`); claimant is not the custodian.
3. Creates `claims` row with `state: "pending"`, `expiresAt: now + claimExpiryHours`.
4. Updates `item.state` to `"claimed"`.
5. Appends `claimed` ledger entry.
6. Notifies the custodian (in-app, and email if configured).
7. Notifies watchers of the item that it has been claimed (so they can watch for it becoming available again).

### Giver confirmation

Mutation: `claims.confirmGiver`

Called by the current custodian. Updates claim state to `giver_confirmed`, records `giverConfirmedAt`. If `exchangeMode: "reveal_contact"`, reveals the claimant's contact details to the giver and vice versa. Notifies the claimant.

### Receiver confirmation

Mutation: `claims.confirmReceiver`

Called by the claimant after the physical exchange. Requires at least one photo in `receiverPhotoIds` — throws `photo_required` if empty.

1. Updates claim state to `receiver_confirmed`, records `receiverConfirmedAt`.
2. System immediately finalizes: updates `item.state` to `"in_custody"`, updates `item.custodianId` to the claimant, updates `item.conditionRating` from `receiverCondition`.
3. Appends `handoff_completed` ledger entry (with receiver photos).
4. Marks claim `completed`.
5. Notifies the giver that custody has moved.
6. Notifies all watchers of the item via `convex/watches.ts:notifyWatchers`.

### Cancel a claim

Mutation: `claims.cancelClaim`

Can be called by the claimant, the custodian, or an admin. Cancels the claim, returns `item.state` to `"available"`, appends `claim_cancelled` ledger entry with the cancellation reason. Notifies the other party.

### Claim expiry

Cron: every 30 minutes, calls `claims.sweepExpiredClaims`.

Finds all claims where `state: "pending"` and `expiresAt < now` (using the `by_state_expiresAt` index to avoid scanning completed claims). For each: sets state to `cancelled`, returns item to `available`, appends `claim_cancelled` ledger entry with `reason: "expired"`, sends notifications.

A ≤24h warning notification is sent once per claim when `expiresAt - now ≤ 86400000 ms`. Tracked by `expiringNotifiedAt` to prevent duplicates.

---

## Branch handoff

**Files:** `convex/branches.ts`, `convex/claims.ts`

Branches are member-hosted physical drop points. When `exchangeMode: "branch"` is set on a claim:

1. Custodian physically delivers the item to the named branch.
2. Custodian calls `branches.placeItemAtBranch`: sets `item.atBranchId`, appends `placed_at_branch` ledger entry. This serves as the giver's confirmation step.
3. Claimant picks up the item from the branch.
4. Claimant calls `claims.confirmReceiver` (with photo). Clears `item.atBranchId`, finalizes custody.

The staging variant (claim created with `staging: true`) allows the branch host to accept or re-route the item before the claimant picks it up.

---

## Repair workflow

**File:** `convex/stewardship.ts`

An item can be claimed specifically for repair (`purpose: "repair"`). The repair claim follows the same two-party confirmation flow as a standard claim. When the repair is complete:

1. Repairer calls `stewardship.completeRepair`: logs a note about what was fixed, updates condition rating.
2. Item returns to `in_custody` state under the repairer.
3. Appends `repair_completed` ledger entry with the repair note (visible to the next person who claims it).
4. Repairer then marks the item available via `stewardship.markAvailable` when ready to pass it along.

---

## Retirement workflow

**File:** `convex/retirements.ts`

Retirement is a two-party approval process: the proposer (typically the current custodian) and a different approver (server manager or admin role).

1. Custodian calls `retirements.propose`: creates a retirement proposal, appends `retirement_proposed` ledger entry.
2. Admin or server manager calls `retirements.approve` (cannot be the same person as the proposer).
3. On approval: sets `item.state` to `"retired"`, sets `item.retiredAt`, appends `retired` ledger entry (terminal). Any active claim is cancelled.
4. If denied: appends `retirement_denied` entry; item remains in circulation.

Self-approval is blocked. Custodian-only retirement is blocked unless the custodian also holds the approver role. This prevents an item being quietly retired without a second set of eyes.

---

## Watching

**File:** `convex/watches.ts`

1. Member clicks "Watch" on an item: creates a `watches` row.
2. When a claim is cancelled or a handoff is confirmed returning custody to the community, `watches.ts:notifyWatchers` fans out in-app notifications to all watchers (except the actor who triggered the event).
3. Watchers receive: "The [item] is looking for a new home." No priority or queue ordering — whoever claims first wins.

---

## Notifications

**File:** `convex/notifications.ts`, `convex/email.ts`, `convex/emailDrain.ts`

Every notification-triggering event:
1. Writes a row to `notifications` (in-app).
2. If the recipient has email enabled and SMTP is configured, also writes a row to `emailOutbox` (state: `queued`).
3. The `emailDrain` cron action (every 1 minute) picks up queued `emailOutbox` rows, calls Nodemailer, updates state to `sent` or `failed`.
4. Failed rows are retried with exponential backoff; after 3 failures, `state: "failed"` and no further retries.

Email reply capture: outbound emails include a claim-specific plus-address (e.g. `replies+claimId@org-domain`) or a `[STWRD#claimId]` token in the subject. The IMAP poller matches replies to the originating claim and writes to `emailInbound`.

---

## Admin operations

**File:** `convex/admin.ts`

### Force-complete a stuck handoff

Admin calls `admin.forceComplete`: skips the photo requirement, writes an `admin_transfer` ledger entry (distinct from `handoff_completed`), moves custody. Always written to `auditEvents`.

### Force-cancel

Admin calls `admin.forceCancelClaim`: cancels any claim regardless of state, returns item to `available`. Logged to `auditEvents`.

### Custodian-inactive recovery

When a member is deactivated (`users.deactivateUser`):
- All their pending claims are cancelled.
- Items they hold enter the recovery queue (visible in Admin → Claims).
- Admin assigns a new custodian via `admin.reassignCustodian`, which writes an `admin_transfer` ledger entry.

### Audit feed

All admin operations append to `auditEvents`. The audit feed (Admin → Audit) is a reverse-chronological view of this table with actor name, action, and detail.

---

## Two-factor authentication flow

**Files:** `convex/authInternal.ts`, `convex/twofactor.ts`, `convex/http.ts`

1. Member submits password at `/login`.
2. Convex Auth password provider verifies credentials.
3. Before creating a session, `authInternal.ts` checks whether a second factor is required (policy `required`, or the account holds a full-permission role).
4. If required: issues a short-lived `mfaPending` token (hashed, stored in `mfaPending` table), returns it to the frontend.
5. Frontend presents the 2FA challenge (TOTP code, email OTP, or recovery code entry).
6. Member submits the factor. The HTTP action at `:3211` verifies it:
   - TOTP: validates against `twoFactor.totpSecretEnc` (decrypted with APP_SECRETS_KEY)
   - Email OTP: validates against `emailOtp.codeHash`; locks after 5 wrong attempts
   - Recovery code: validates against `twoFactor.recoveryCodeHashes`; marks used and removes
7. On success: `mfaPending.secondFactorSatisfied` flips true; the token can now be exchanged for a Convex session.
8. Session is created; member is logged in.

Full-permission accounts (server-manager, admin) are always second-factored regardless of policy setting.
