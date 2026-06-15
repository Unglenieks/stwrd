# Stwrd — Technical Specification

**Version:** 3.0 · **Date:** 2026-06-11 · **Status:** Agent-executable (normative). Review logs: Appendix A (v1→v2), Appendix B (v2→v3)

---

## 1. Overview

A self-hostable web application (Stwrd) that lets a community organization share tools, equipment, and other things with no central physical collection. Items live with members. Custody — not shelving — is the organizing principle: every item is in the care of exactly one member at all times, and an append-only ledger records every change of hands, repair, and condition observation across the item's life.

Each community org runs its own isolated instance (one org per install). The instance starts empty; the catalog grows as members contribute items they're willing to share. When a holder marks an item "returned," nothing physically moves — the holder becomes the item's de facto librarian until another member claims it and the two of them complete a confirmed handoff.

### 1.1 Design goals

- **Zero-warehouse operation.** The system must never assume a central storage location. Optional member-hosted "branches" (little-free-library-style drop points) are the only physical infrastructure, and they are member property.
- **Trustworthy chain of custody.** Two-party confirmation of every transfer, with a required receiver photo, so the ledger is evidence-grade within the community's trust model.
- **Sovereignty.** Fully self-hosted: app, database, file storage, and email all run on or connect to org-controlled infrastructure. No third-party SaaS dependencies at runtime.
- **Simple to operate.** A single `docker compose up` (or LXC equivalent) brings up the whole stack. One technical volunteer ("server manager") should be able to run it.
- **Repair-positive.** Fixing things is a first-class activity, not an exception path. Damaged items flow naturally to members who want to repair them.

### 1.2 Permanent non-goals (by design, not merely deferred)

- Multi-tenancy — one org per instance.
- Public/anonymous catalog browsing — members-only; login required for everything.
- Due dates, fines, or overdue enforcement — custody is indefinite.
- **In-app messaging of any kind, ever.** This is a management system, not a communication platform. It connects members by revealing contact information inside an active claim; how a community actually talks (email, phone, group chat, over the fence) is its own affair. Captured email replies (§13) are a passive coordination *record*, not a chat surface, and will stay that way.
- Reservation queues or waitlists — first confirmed claim wins, always. Watchlists (§9.5) cover "tell me when it's free" without queue politics.

### 1.3 Non-goals (v1 only)

- Federation between org instances (future consideration).
- Native mobile apps (responsive web app only; the handoff photo flow must work well in mobile browsers).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Org** | The community organization operating one instance. |
| **Server manager** | The bootstrap superuser role; full permissions, cannot be deleted or stripped below full access by anyone but themselves (and never if they are the last one). |
| **Member** | Any authenticated user of the instance. |
| **Custodian** | The member currently responsible for an item's physical care. Every non-retired item has exactly one. |
| **Holder** | Synonym for custodian, used in UI copy. |
| **Contribution** | The act of adding a new item to the catalog; creates the item's genesis ledger entry. |
| **Claim** | A member's declaration of intent to take custody of an available item. Instant (no approval), but provisional until handoff confirmation. |
| **Handoff** | The physical exchange. Finalized in-app by two-party confirmation plus a receiver-side photo. |
| **Ledger** | The append-only sequence of events for an item. Never edited or deleted; corrections are new entries. |
| **Branch** | A member-hosted physical drop point with public physical access, registered in the system. |
| **Repair checkout** | A claim whose declared purpose is restoring a damaged item rather than using it. |
| **Retirement** | Permanent removal of an item from circulation, recorded as a terminal ledger entry. The record remains. |

---

## 3. System architecture

### 3.1 Components

Three services, one Docker Compose stack (or equivalent LXC layout):

1. **Convex backend** (`ghcr.io/get-convex/convex-backend`) — the open-source self-hosted Convex instance. Provides the reactive database, serverless functions (queries/mutations/actions), scheduled jobs (crons), file storage for item photos, and HTTP actions. Listens on port 3210 (client API) and 3211 (HTTP actions). Persists to a Docker volume; SQLite by default, optionally an external Postgres via `POSTGRES_URL` for larger installs.
2. **Convex dashboard** (`ghcr.io/get-convex/convex-dashboard`) — operator-facing admin console on port 6791, authenticated with the instance admin key. This is *infrastructure* tooling for the server manager (inspecting tables, logs, running functions), distinct from the in-app admin dashboard (§15).
3. **Web frontend** — TanStack Start app served by its own Node container, connecting to the Convex backend over WebSocket. All member and admin UI lives here.

```
                ┌────────────────────────────────────────────┐
                │              Docker / LXC host             │
                │                                            │
 Members ──────▶│  frontend (TanStack Start, :3000)          │
 (browser)      │        │ WebSocket / HTTP                  │
                │        ▼                                   │
                │  convex-backend (:3210 api, :3211 http)    │
                │        │                  │                │
                │   [volume: db+files]   SMTP/IMAP ──────────┼──▶ org mailbox
                │                                            │
 Server mgr ───▶│  convex-dashboard (:6791, admin key)       │
                └────────────────────────────────────────────┘
```

A reverse proxy (Caddy or Traefik, included in the reference compose file) terminates TLS and routes a single public hostname to the frontend, with the Convex client API exposed on a subpath or subdomain. The Convex dashboard should **not** be exposed publicly by default (bind to localhost / LAN / VPN).

### 3.2 Why Convex fits this app

- The item ledger is naturally an append-only table; Convex mutations are transactional, so "append ledger entry + flip item state" is atomic with no race conditions between two members claiming the same item simultaneously.
- Reactive queries mean both parties of a handoff watch the same claim document live: when the receiver uploads the photo and confirms, the giver's screen updates instantly, no polling.
- Built-in file storage handles contribution and handoff photos without adding an S3/MinIO service.
- Crons handle claim expiry sweeps and the IMAP poll.
- The self-hosted distribution is officially supported, ships as pinned container images, and runs single-node on SQLite — the right operational weight for a community org.

### 3.3 LXC hosting note

The reference deployment is Docker Compose. For LXC, the spec requires only that the three services run with the same env contract: either (a) Docker nested inside an LXC container (Proxmox-style, the common path), or (b) the published Convex backend binary + Node frontend installed directly in containers with the same ports, volumes, and environment variables. The spec treats compose as canonical and documents the env contract (§19.3) so an LXC translation is mechanical.

---

## 4. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Backend platform | **Convex (self-hosted, open source)** | Hard requirement. Pinned image version, not `latest`. |
| Backend language | TypeScript (Convex functions) | Strict mode. All business logic in Convex mutations/actions; the frontend never writes state directly. |
| Database | Convex's storage (SQLite default; Postgres optional) | Org's choice at deploy time via `POSTGRES_URL`. |
| Frontend framework | **TanStack Start** (React, SSR-capable) | File-based routing via TanStack Router; Convex integration through `@convex-dev/react-query` + TanStack Query. |
| UI components | **shadcn/ui** on Tailwind CSS | Hard requirement (shadcn). Radix primitives, fully self-hosted assets, no CDN fonts at runtime. |
| Auth | **Convex Auth** (password provider) + custom second-factor step (**TOTP + email OTP**, recovery codes) | Convex Auth runs fully on the self-hosted backend (manual setup; the CLI does not scaffold self-hosted). Self-registration disabled. Auth endpoints are Convex **HTTP actions** so per-IP rate limiting sees the forwarded client IP. |
| Forms/validation | TanStack Form + Zod (shared schemas between client and Convex validators) | |
| Email out | SMTP via org-configured account (Nodemailer in Convex actions) | |
| Email in | IMAP poll via scheduled Convex action (ImapFlow) | See §13. |
| Images | Convex file storage; client-side downscale/EXIF-strip before upload | See §18.2. |
| Tooling | pnpm, Vitest, Playwright (handoff flow e2e), ESLint + Prettier | |

---

## 5. Roles & permissions

### 5.1 Model

Authorization is **granular permissions composed into org-named roles**. There are no hard-coded role behaviors except the server manager bootstrap. A role is just `{ name, description, permissions: Permission[] }`, created and edited by anyone holding `roles.manage`. Members may hold multiple roles; effective permissions are the union. Every permission check happens server-side in Convex functions via a single `requirePermission(ctx, perm)` helper — the UI only uses permissions to hide/show affordances, never as enforcement.

Two roles ship as defaults (renamable, editable):

- **Server Manager** — all permissions. At least one member must always hold a role containing all permissions; the system refuses any mutation that would leave zero full-permission members.
- **Member** — the baseline circulation set (marked ✦ below). Assigned automatically to new accounts.

### 5.2 Permission catalog (v1)

| Key | Grants |
|---|---|
| `items.contribute` ✦ | Add new items to the catalog. |
| `items.claim` ✦ | Claim available items and complete handoffs. |
| `items.update_own` ✦ | Edit details / add status & repair notes on items in own custody. |
| `items.edit_any` | Edit metadata of any item (typo fixes, recategorization). |
| `items.retire_propose` ✦ | Propose retirement of an item in own custody. |
| `items.retire_approve` | Approve/deny retirement proposals. |
| `items.ledger_annotate` | Append correction/annotation entries to any item's ledger. |
| `categories.manage` | Create/edit/merge/archive categories and curate the tag namespace. |
| `branches.create` ✦* | Register a branch at one's own property. (*Orgs that don't want branches remove this from the Member role — this is the "if an org chooses" switch.) |
| `branches.manage_any` | Edit/deactivate any branch. |
| `users.create` | Provision member accounts and send invites. |
| `users.manage` | Deactivate/reactivate accounts, reset credentials, edit profiles. |
| `roles.manage` | Create/edit roles and assign them to members. |
| `claims.manage_any` | Cancel any pending claim, and resolve stuck handoffs by force-completing (recorded as `admin_transfer`, never a synthetic `handoff_completed` — §9.3) or force-cancelling, with a recorded reason. |
| `instance.settings` | Edit org settings: SMTP/IMAP, claim expiry window, org name/branding, photo retention. |
| `instance.audit_view` | View the cross-item admin audit feed and email delivery log. |

The catalog is closed and versioned in code; orgs compose roles from it but cannot invent new permission keys (keeps server-side checks exhaustive and testable).

---

## 6. Authentication

### 6.1 Account provisioning

No self-registration. A member with `users.create` enters name + email; the system generates a single-use, expiring (72 h) invite link, delivered by email (if SMTP is configured) or displayed for out-of-band sharing. Following the link, the invitee sets a password (zxcvbn strength gate) and lands in onboarding.

### 6.2 Login & second factor

Login runs through dedicated Convex **HTTP actions** (so the backend sees `X-Forwarded-For` from the proxy for per-IP rate limiting) and follows an explicit elevation state machine — necessary because Convex Auth has no built-in mid-flow 2FA, so the second-factor step is ours to define:

1. **Password phase**: email + password (Convex Auth password provider; Argon2id). Success issues a short-lived (5-minute, single-use) `mfa_pending` token — not a session.
2. **Second-factor phase** (when required by policy, below): the client exchanges the pending token plus one of:
   - **TOTP** (preferred when enrolled): standard otpauth QR enrollment; secret encrypted with `APP_SECRETS_KEY`; ±1 time-step tolerance.
   - **Email OTP**: 6-digit code, 10-minute TTL, single use, 5-attempt lockout with backoff, sent via org SMTP.
   - **Recovery code**: ten single-use codes generated and shown exactly once at 2FA enrollment, stored hashed — the escape hatch when the mailbox is down and the phone is lost.
3. Success establishes the session (httpOnly Secure cookie, 30-day rolling expiry, per-device revocation from user settings).

**Org 2FA policy** (`instanceSettings.twoFactorPolicy`, chosen in the setup wizard, editable under `instance.settings`):

- `required` (default): every account completes a second factor; members enroll TOTP and/or use email OTP. First login after accepting an invite uses email OTP (the invite already proved mailbox control); TOTP enrollment is offered immediately afterward.
- `off`: accounts created after the server manager log in with password only. Members may still *voluntarily* enroll a second factor, which is then enforced for their own account. Accounts holding a full-permission role (server managers) **always** require a second factor once SMTP or TOTP enrollment is available — the keys to the instance never ride on a single password.

If SMTP is unconfigured (fresh install): the bootstrap server manager may use password + TOTP, or password only until either factor becomes configurable, with a persistent admin banner until email works. Under `required` policy, members without TOTP enrolled cannot complete login while SMTP is down — the settings page calls out this coupling.

### 6.3 Bootstrap

First run executes a setup wizard (frontend route gated on "zero users exist"): create the server-manager account, name the org, choose the 2FA policy (`required`/`off`), optionally configure SMTP/IMAP, set the claim-expiry default. The wizard writes the `instanceSettings` singleton and seeds the two default roles.

### 6.4 Deactivation

Deactivating a member (requires `users.manage`) blocks login immediately but **preserves all ledger history** (entries reference user IDs, never deleted). Items in the deactivated member's custody are flagged "custodian inactive" in an admin queue; a member with `claims.manage_any` + `items.edit_any` records an administrative custody transfer (a distinct ledger entry type, §8.3) to whoever physically recovers each item.

---

## 7. Data model (Convex schema)

All tables below are Convex tables defined in `convex/schema.ts` with validators; indexes noted inline. IDs are Convex document IDs.

### 7.1 `users`
`{ name, email (unique idx), avatarFileId?, status: "invited"|"active"|"inactive", contactPhone?, defaultExchangePref: "reveal_contact"|"branch"|null, notificationPref: "in_app"|"email", createdAt }`
Auth credentials live in Convex Auth's own tables.

### 7.2 `roles` and `roleAssignments`
`roles: { name (unique idx), description, permissions: string[], isSystemDefault: boolean }`
`roleAssignments: { userId (idx), roleId (idx) }`

### 7.3 `items`
`{ title, description, categoryId (idx), tags: string[] (search idx), attributes: { key, value }[],`
`  state: "available"|"claimed"|"in_custody"|"under_repair"|"retired" (idx),`
`  custodianId (idx), atBranchId?: Id<"branches"> (idx), conditionRating: 1–5,`
`  primaryPhotoId, ledgerSeq: number, contributedBy, contributedAt, retiredAt? }`
`custodianId` is denormalized truth-of-now; the ledger is truth-of-history. A search index over `title, description, tags` powers catalog search.

### 7.4 `ledgerEntries` — the heart of the system
Append-only. No mutation ever updates or deletes a row here; the only write is insert.

`{ itemId (idx by itemId+seq), seq: number, type, actorId, counterpartyId?, claimId?,`
`  conditionRating?, note?, photoFileIds: Id<"_storage">[], branchId?, createdAt }`

Entry `type` values:

| Type | Written when | Required payload |
|---|---|---|
| `contributed` | Item created | ≥1 photo, condition rating, full details snapshot |
| `claimed` | Claim placed | claimId |
| `claim_cancelled` | Expiry sweep or manual cancel | claimId, reason (`expired`/`by_holder`/`by_claimant`/`admin`) |
| `handoff_completed` | Both parties confirmed | claimId, **≥1 receiver photo**, receiver condition rating |
| `status_update` | Holder posts a status note | note |
| `repair_started` / `repair_completed` | Repair custodian updates | note; photos encouraged |
| `marked_available` | Holder lists item for claiming | exchange preference snapshot, optional branchId |
| `placed_at_branch` / `removed_from_branch` | Branch flag toggled | branchId |
| `retirement_proposed` / `retired` / `retirement_denied` | Disposal workflow | reason note |
| `admin_transfer` | Administrative custody correction (e.g., inactive member recovery) | note, new custodian |
| `annotation` | Ledger correction note (`items.ledger_annotate`) | note, optional reference to seq being corrected |

`seq` comes from `items.ledgerSeq`, incremented in the same mutation that inserts the entry — transactional (no gaps or dupes) and no index scan to find the latest entry.

### 7.5 `claims`
`{ itemId (idx), claimantId (idx), purpose: "use"|"repair", staging: boolean (default false), state: "pending"|"giver_confirmed"|"receiver_confirmed"|"completed"|"cancelled",`
`  exchangeMode: "reveal_contact"|"branch", branchId?, contactRevealed: boolean,`
`  receiverPhotoIds: [], receiverCondition?, giverConfirmedAt?, receiverConfirmedAt?, expiresAt, createdAt }`
Partial-unique invariant enforced in mutation: at most one non-terminal claim per item.

### 7.6 `branches`
`{ name, hostUserId (idx), description, locationText, geo?: {lat,lng}, accessNotes, photoFileIds: [], status: "active"|"inactive" }`
`locationText` is free-text by design (rural addresses, "blue shed behind the co-op"). Geo pin optional.

### 7.7 `categories`
`{ name, parentId? (idx), description?, archived: boolean }` — a managed tree, depth ≤ 3. Items reference leaf or non-leaf nodes. Tags are free-form strings on items; `categories.manage` holders can rename/merge tags globally (batch mutation). Tags normalize on write: trimmed, lowercased, ≤ 32 chars each, ≤ 10 per item (`validation_failed` otherwise).

### 7.8 `notifications`
`{ userId (idx by userId+read), kind, payload, read: boolean, emailState?: "queued"|"sent"|"failed"|"skipped", createdAt }`

### 7.9 `emailOutbox` / `emailInbound`
Outbox: `{ to, template, payload, state: "queued"|"sent"|"failed", attempts, lastError?, messageId?, createdAt }` — written by mutations, drained by an action (mutations can't do I/O; this is the standard Convex outbox pattern, and it doubles as the delivery log).
Inbound: `{ imapUid, from, subject, inReplyTo?, matchedClaimId?, matchedUserId?, bodyText (plaintext only, capped 32 KB), disposition: "logged"|"bounce"|"unmatched", receivedAt }`

### 7.10 `instanceSettings` (singleton)
`{ orgName, claimExpiryHours (default 168), twoFactorPolicy: "required"|"off" (default "required"), smtp: {...}?, imap: {...}?, branchesEnabled: boolean, photoMaxEdgePx (default 2048), setupCompleted }`
SMTP/IMAP credentials are stored encrypted with a key from the Convex deployment environment (`APP_SECRETS_KEY`, see §19.1), not plaintext in the table.

### 7.11 `watches`
`{ userId (idx), itemId (idx), createdAt }` — unique per (user, item), enforced in the mutation. Powers the watchlist (§9.5).

---

## 8. Item lifecycle

### 8.1 State machine

```
 contribute ──▶ AVAILABLE ◀────────────── marked_available ────┐
                  │  claim (instant)                           │
                  ▼                                            │
               CLAIMED ── expiry/cancel ──▶ AVAILABLE          │
                  │  both confirm + photo                      │
                  ▼                                            │
   purpose=use  IN_CUSTODY ──────────────────────────────────▶─┤
   purpose=repair UNDER_REPAIR ── repair_completed ──▶ IN_CUSTODY
                  │
                  └── retirement approved ──▶ RETIRED (terminal)
```

- **AVAILABLE**: claimable; physically still with `custodianId`. Holder's exchange preference for this listing (reveal contact vs. branch) was snapshotted at `marked_available` time.
- **CLAIMED**: a pending claim exists; item hidden from "claim" actions for everyone else but visible with a "spoken for" badge.
- **IN_CUSTODY**: the steady state; custodian may post `status_update`s, edit details (`items.update_own`), mark available, or propose retirement.
- **UNDER_REPAIR**: same as IN_CUSTODY plus repair-specific UI; entered when a `purpose: "repair"` claim completes. Exiting requires a `repair_completed` entry (with note), returning the item to IN_CUSTODY under the repairer — who then typically marks it available again.
- **RETIRED**: terminal. Item remains viewable with full ledger; excluded from catalog browse by default (toggle to include).

### 8.2 Contribution flow

1. Member (with `items.contribute`) fills the contribution form: title, description, category (picker over the managed tree), free tags, structured attributes (key/value, e.g. "blade width: 10″"), condition rating (a 1–5 **slider** with the rubric label shown at each stop), ≥1 photo.
2. Photos are downscaled and EXIF-stripped client-side, uploaded to Convex storage.
3. Mutation creates the item in **AVAILABLE** state with the contributor as custodian and writes the `contributed` genesis ledger entry. The contributor's default exchange preference is applied (editable per listing).

### 8.3 Custody invariants (enforced in every mutation)

- Exactly one custodian per non-retired item, always.
- Custody changes **only** via `handoff_completed` or `admin_transfer` ledger entries — there is no "edit custodian" path.
- Every ledger insert and its corresponding `items` state change occur in the same Convex mutation (atomic).
- `seq` strictly increases by 1 per item.

---

## 9. Claim & handoff protocol

The core interaction. Designed so the ledger entry for a transfer is only written when both humans agree it physically happened, with photographic evidence from the receiving side.

### 9.1 Claiming

1. Claimant hits **Claim** on an AVAILABLE item (instant — no holder approval), choosing purpose: *use* or *repair*. Mutation atomically: checks no live claim exists, creates the claim (`pending`, `expiresAt = now + claimExpiryHours`), flips item to CLAIMED, writes `claimed` ledger entry, notifies the holder.
2. Coordination unlocks per the listing's exchange mode:
   - **reveal_contact**: both parties now see each other's email (and phone if provided). `contactRevealed: true` is recorded.
   - **branch**: the claim shows the branch card (location text, access notes, host's notes). No contact reveal needed; the holder deposits the item at the branch and taps "dropped off" (sets `giver_confirmed` early — see below).

### 9.2 Two-party confirmation

The claim screen is live (reactive query) for both parties and shows a two-slot checklist:

- **Giver confirms** ("I handed it off" / "I dropped it at the branch").
- **Receiver confirms**, which *requires* in the same step: ≥1 photo of the item as received (camera capture or upload) + a condition rating (the same 1–5 slider and rubric). The confirm button stays disabled until a photo is attached.

Order is unconstrained (branch flows are asynchronous by nature). When the second confirmation lands, one mutation finalizes: claim → `completed`, item → IN_CUSTODY (or UNDER_REPAIR) with the receiver as custodian, `handoff_completed` ledger entry embedding the receiver photos and rating, `removed_from_branch` entry if applicable, notifications to both.

If the receiver's photo/condition rating reports significantly worse condition than the listing claimed, the handoff still completes (the receiver chose to accept it), but the discrepancy is visible forever in the ledger — that transparency *is* the dispute mechanism in v1.

### 9.3 Expiry & cancellation

- **Auto-expiry**: a Convex cron sweeps claims past `expiresAt` (org-configurable window, default 7 days): claim → `cancelled` (reason `expired`), item → AVAILABLE, both parties notified.
- **Manual cancel**: claimant can withdraw; holder can cancel a stale claim at any time (no waiting for expiry); `claims.manage_any` holders can cancel anything. All write `claim_cancelled` with the reason enum.
- A pending claim pauses its expiry countdown once either party has confirmed — concretely, the sweep skips any claim with `giverConfirmedAt` or `receiverConfirmedAt` set (a half-done branch drop shouldn't auto-revert while the item sits in the branch box — instead it surfaces in an admin "stuck handoffs" queue after the window passes, where a `claims.manage_any` holder can nudge both parties, force-complete, or force-cancel with a recorded reason). Force-complete records an **`admin_transfer`** ledger entry, never a synthetic `handoff_completed` — the invariant that every `handoff_completed` carries ≥1 receiver photo is absolute.

### 9.4 Concurrency

Convex mutations are serializable; the "claim" mutation's existence-check-then-insert is atomic, so two members tapping Claim simultaneously results in exactly one claim and one polite "just missed it" toast.

### 9.5 Watching (and why there are no waitlists)

Any member can **watch** an item from its page. When a watched item transitions to AVAILABLE, every watcher gets a `watched_item_available` notification (in-app, plus email per preference). Watching confers **zero priority** — the notification is a starting gun, not a place in line. Queues and waitlists are a permanent non-goal (§1.2): they create obligation, scorekeeping, and disputes a trust-based community library is better off without. First confirmed claim wins, every time.

---

## 10. Repair workflow

Damage is handled through the normal circulation machinery, deliberately:

1. A custodian discovers damage → posts a `status_update` (note + photos) and may lower the condition rating. If they can't fix it, they mark the item AVAILABLE, typically tagging the listing note "needs repair."
2. A repair-minded member claims it with **purpose: repair**. The catalog supports filtering by condition ≤ 2 and by `under_repair`/"needs repair" so fixers can browse for projects.
3. Handoff completes as normal (§9) → item enters UNDER_REPAIR with the fixer as custodian.
4. The fixer logs `repair_started` / progress `status_update`s / `repair_completed` entries with notes and photos. Completion raises the condition rating (their judgment) and returns the item to IN_CUSTODY.
5. The fixer keeps it or marks it AVAILABLE for the next borrower.

Nothing stops a *use*-purpose custodian from logging repairs they did themselves (`repair_completed` is writable by any current custodian); the dedicated purpose exists so the community can see an item is being worked on rather than hoarded, and so fixer activity is legible in member profiles ("12 repairs completed").

## 11. Retirement (disposal)

For items beyond economical repair ("ship of Theseus" territory):

1. Current custodian (with `items.retire_propose`) proposes retirement with a required reason and current photos → `retirement_proposed` ledger entry; item badge "retirement proposed" (still claimable — someone with `items.retire_approve` might instead see a fixable item, deny, and let a fixer claim it).
2. A member with `items.retire_approve` approves or denies. The proposer cannot approve their own proposal unless they are the only approver in the org (small-org escape hatch, flagged in the audit feed).
3. Approval writes the terminal `retired` entry; state → RETIRED; the physical object is the custodian's to dispose of responsibly. Denial writes `retirement_denied` with a note.

Retired items are never deleted: the ledger is the org's institutional memory (and its provenance record if disposal is later questioned).

## 12. Branches

Branches are member-hosted physical drop points — the "little free library" pattern — that decouple handoffs in time so two schedules never have to align.

- **Creation**: any member with `branches.create` registers a branch on their own property: name, free-text location, access notes ("combo 4312, latch sticks"), photos. Orgs opt out of the whole feature by removing `branches.create` from the Member role or flipping `branchesEnabled` off.
- **Custody semantics (hybrid, per decision)**: an item placed at a branch keeps a *person* as custodian of record — the branch **host** — while the item carries the `atBranchId` flag. The ledger writes `placed_at_branch` (custodian → host via a lightweight implicit transfer when the depositor isn't the host… see below) and `removed_from_branch` on pickup.
  - When a **holder lists an item with branch exchange mode and drops it off**, their "dropped off" tap is their giver-confirmation on the live claim; custody formally moves to the *claimant* at receiver-confirmation, but between drop and pickup the item is physically in the host's box — the `atBranchId` flag plus the claim record make that interval legible. The host is *not* inserted as a ledger custodian for claim-in-flight drops (avoids doubling every branch handoff into two transfers).
  - When a member wants to **stage an unclaimed item at a branch** ("park my ladder at the co-op branch"), that *is* a real custody transfer to the host and requires the host's confirmation — it runs through the standard claim machinery with the host as receiver, then the host marks it AVAILABLE with `atBranchId` set. Hosts therefore see and accept what enters their care. (Normatively: `claims.createStaging`, §22.2 — finalize leaves the item IN_CUSTODY under the host with `placed_at_branch` written; the host's one-tap "list it" performs `marked_available`.)
- **Branch page**: each branch has a page listing items currently flagged to it, claim-in-flight items awaiting pickup (visible only to the involved parties + host), and host contact/access info.
- "Public access" is **physical** only — anyone can walk up to the box — but the digital catalog remains members-only per §1.2.

## 13. Email integration (SMTP + IMAP)

The server manager connects the instance to an **org-owned mailbox** in Settings (host, port, TLS mode, username, app password — stored encrypted, §7.10), with a "send test email" button. Convex actions perform all socket I/O; mutations only enqueue.

**Outbound (SMTP)** — required for normal operation:
- 2FA OTP codes and invite links (transactional; always sent regardless of preference).
- Notification emails (claim placed on your item, handoff confirmed, claim expiring in 24 h, claim cancelled, retirement decision, branch activity on your hosted branch) — sent only for users whose `notificationPref = "email"`; everyone always gets the in-app version.
- Outbox pattern: mutation inserts into `emailOutbox`; a cron-driven action drains the queue with retry/backoff (3 attempts), recording failures for the admin delivery log. Each message sets a `Message-ID` and a reply-to tagged address when supported (`library+claim-<id>@org.example`), else a `[STWRD#<id>]` subject token.

**Inbound (IMAP)** — confirmed scope: a scheduled action polls the mailbox (connect → fetch unseen → disconnect, default every 2 min) and:
1. **Bounce/DSN detection** — failed deliveries mark the outbox row `failed` and surface a "member email may be broken" admin alert.
2. **Reply capture** — replies matched via `In-Reply-To`/plus-address/subject token to a claim get their text appended to that claim's coordination **record**: a passive log visible to both parties, not a chat surface — and per §1.2 it never becomes one; members communicate through their own channels. Unmatched mail lands in an admin "unmatched inbound" list.
Inbound mail never triggers state changes (no "confirm by email" in v1 — confirmation requires the photo step in-app).

If SMTP is unconfigured: in-app notifications still work. Under `twoFactorPolicy: required`, members without TOTP enrolled cannot complete login (email OTP impossible); under `off`, logins proceed normally. A red banner nags the server manager either way.

## 14. Notifications

Single `notifications` table drives an in-app inbox (bell icon, unread badge, reactive). Kinds: `claim_placed`, `claim_cancelled`, `claim_expiring`, `watched_item_available`, `handoff_confirmed_by_other`, `handoff_completed`, `inbound_reply`, `retirement_decision`, `branch_item_placed`, `account/security events`. Each kind maps to an email template used when the recipient prefers email. Per-user preference is the single toggle `in_app | email` (per-kind matrices are deferred — v1 stays simple).

---

## 15. Admin dashboard (in-app)

A `/admin` section of the frontend, gated per-feature by permissions (a user sees only the panels their permissions allow):

- **Members** (`users.create`, `users.manage`): list with status/roles/held-item counts; invite flow; deactivate (with held-items recovery queue, §6.4); resend invites; reset 2FA lockouts.
- **Roles** (`roles.manage`): role builder — name, description, checkbox grid over the permission catalog; assignment matrix; guard rails around the last full-permission member.
- **Categories & tags** (`categories.manage`): tree editor (add/rename/move/archive, depth ≤ 3); tag list with usage counts, rename/merge.
- **Claims & circulation** (`claims.manage_any`): live claims board; stuck-handoffs queue (§9.3) with nudge, force-complete (`admin_transfer`), and force-cancel (reason required).
- **Retirements** (`items.retire_approve`): proposal queue with photos/ledger context; approve/deny.
- **Branches** (`branches.manage_any`): all branches, deactivate, reassign host.
- **Settings** (`instance.settings`): org identity, SMTP/IMAP config + test, 2FA policy, claim expiry hours, branches toggle, photo size policy.
- **Audit & email** (`instance.audit_view`): cross-item feed of sensitive events (role changes, admin transfers, cancellations, settings edits) and the email delivery log with failures.

## 16. Member-facing UI

- **Catalog** (`/items`): card grid, search box (Convex search index), filters: category tree, tags, state, condition range, "at a branch," "needs repair." Default excludes RETIRED.
- **Item page** (`/items/:id`): photo gallery, details/attributes, state badge, custodian, branch card if flagged, **ledger timeline** (the centerpiece — vertical timeline of every entry with actor, photos, condition deltas), a **Watch** toggle, and the context-correct primary action (Claim / your live claim checklist / holder controls).
- **My library** (`/me`): *In my care* (with per-item actions: status update, mark available, propose retirement, repair log), *My claims* (live checklists), *Contributed by me*, *Watching*, *My branch* (if host).
- **Contribute** (`/contribute`): the §8.2 form, mobile-camera-first.
- **Claim screen**: the live two-slot confirmation UI (§9.2) with photo capture; designed for two phones standing in a driveway.
- **Member profile**: display name, items in care (count + list), contributions, repairs completed; contact details visible only inside an active mutual claim with `reveal_contact`.
- **Notifications inbox** and **account settings** (password, sessions, notification pref, default exchange pref, phone).

shadcn/ui supplies the component layer (cards, dialogs, command palette for search, data tables in admin, toasts); Tailwind theme tokens make org-level light branding (name + accent color) trivial.

---

## 17. Search & discovery

- Convex search index over `title + description + tags`; filter fields on `state`, `categoryId`, `conditionRating`, `atBranchId`.
- Category browse pages; tag chips link to filtered views.
- "Fixer feed": saved filter for damaged/needs-repair items (§10).
- Default catalog sort: most recently AVAILABLE first (timestamp of the latest `marked_available`/`contributed` entry, denormalized onto the item).
- Catalog and ledger-timeline queries use Convex paginated queries (`usePaginatedQuery`) — no unbounded result sets.
- No external search service in v1; Convex's built-in full-text is sufficient at community scale (hundreds–low thousands of items).

## 18. Non-functional requirements

### 18.1 Security
- All authorization server-side in Convex functions; UI gating is cosmetic.
- Sessions: httpOnly, Secure, SameSite=Lax cookies; CSRF-safe by Convex's WebSocket/auth-token design; rate limiting on login/OTP endpoints — per-account counters in-table; per-IP limits enforced in the auth HTTP actions using the proxy's `X-Forwarded-For` (WebSocket mutations never see client IPs, which is why auth rides on HTTP actions, §6.2).
- Secrets: SMTP/IMAP credentials encrypted at rest with `APP_SECRETS_KEY` from the environment; admin key for the Convex dashboard never embedded in the frontend.
- Photos: EXIF (incl. GPS) stripped client-side; a server action then *verifies* — re-parses headers and rejects anything still carrying EXIF/GPS — rather than re-encoding (cheap check, no double image processing). Handoff photos must never leak members' home coordinates.
- File access: Convex storage URLs fetched through authenticated queries only.
- Dependency pinning; container images pinned by digest; weekly `pnpm audit` in CI.

### 18.2 Media policy
Client downscales images to `photoMaxEdgePx` (default 2048) and re-encodes to WebP/JPEG ≤ ~500 KB before upload; server rejects > 5 MB or non-image MIME. A weekly cron garbage-collects storage files referenced by no item, ledger entry, claim, branch, or avatar — covering photos uploaded to claims that were cancelled before confirmation. Expected steady-state storage at 1,000 items × ~15 ledger photos ≈ 7–8 GB — fine on a volume, and the reason §18.4 backups matter.

### 18.3 Performance & scale targets
Single org ≤ ~2,000 members, ≤ ~10,000 items, ≤ ~100 concurrent sessions — comfortably single-node. SQLite default; document the Postgres switch (`POSTGRES_URL`) as the growth path. Reactive queries scoped narrowly (per-item, per-user) to keep invalidation cheap.

### 18.4 Backup & restore
- Primary: a nightly host cron runs `npx convex export` (with the admin key) against the running backend — a consistent snapshot of all tables **and** file storage, retained 14 daily / 8 weekly.
- Secondary: raw volume copies only with the backend stopped, or via filesystem snapshot — live-copying SQLite invites a corrupt backup.
- Restore: `npx convex import` into a fresh stack; the documented drill is exercised in CI against a seeded instance.

### 18.5 Observability
Convex dashboard provides function logs/metrics. Frontend container logs to stdout (JSON). Health endpoints: backend `/version` (built-in), frontend `/healthz`. Optional Uptime-Kuma snippet in docs.

---

## 19. Deployment

### 19.1 Reference `docker-compose.yml` (abridged)

```yaml
services:
  backend:
    image: ghcr.io/get-convex/convex-backend:<pinned>
    environment:
      - INSTANCE_NAME=${INSTANCE_NAME}
      - INSTANCE_SECRET=${INSTANCE_SECRET}
      - CONVEX_CLOUD_ORIGIN=${PUBLIC_API_ORIGIN}      # e.g. https://library.example.org/api
      - CONVEX_SITE_ORIGIN=${PUBLIC_SITE_ORIGIN}      # http actions origin
      - POSTGRES_URL=${POSTGRES_URL:-}                # empty ⇒ SQLite
      - DISABLE_BEACON=true
    volumes: [ data:/convex/data ]
    healthcheck: { test: curl -f http://localhost:3210/version }
  dashboard:
    image: ghcr.io/get-convex/convex-dashboard:<pinned>
    ports: [ "127.0.0.1:6791:6791" ]                  # localhost-only by default
    depends_on: { backend: { condition: service_healthy } }
  frontend:
    build: ./apps/web                                  # TanStack Start, Node 22 runtime
    environment:
      - PUBLIC_API_ORIGIN=${PUBLIC_API_ORIGIN}        # written to runtime-config.json at start
      - PUBLIC_SITE_ORIGIN=${PUBLIC_SITE_ORIGIN}      # secrets do NOT go here
    depends_on: [ backend ]
  proxy:
    image: caddy:2
    ports: [ "80:80", "443:443" ]
    volumes: [ ./Caddyfile:/etc/caddy/Caddyfile, caddy_data:/data ]
volumes: { data: {}, caddy_data: {} }
```

Function-side secrets (`APP_SECRETS_KEY`, anything the encryption layer needs) are **Convex deployment environment variables**, set with `npx convex env set` or via the dashboard — they belong in the backend where the actions that use them run, never in the frontend container.

### 19.2 First-run procedure
1. `cp .env.example .env`, fill domain + generated secrets.
2. `docker compose up -d`.
3. `docker compose exec backend ./generate_admin_key.sh` → store the admin key (Convex dashboard + function deploys).
4. Deploy functions: `npx convex deploy` against the self-hosted URL with the admin key (wrapped in `make deploy`), then set function secrets: `npx convex env set APP_SECRETS_KEY <generated>`.
5. Visit the site → setup wizard (§6.3).

### 19.3 Environment contract (for LXC parity)
`INSTANCE_NAME`, `INSTANCE_SECRET`, `PUBLIC_API_ORIGIN`, `PUBLIC_SITE_ORIGIN`, `POSTGRES_URL?` (frontend receives the two origins runtime-injected, §19.5), proxy hostname — plus `APP_SECRETS_KEY` as a Convex deployment env var (§19.1). Any runtime providing these three processes + one persistent data directory + one ingress is a conforming deployment.

### 19.4 Upgrades
Pinned image tags bumped via tagged releases of this repo; release notes call out Convex backend version bumps and migration notes. `convex deploy` pushes function/schema changes; Convex schema validation gates incompatible changes.

### 19.5 Hostname, TLS & domain changes

- **Single source of truth**: the public hostname lives in `.env` as `PUBLIC_SITE_ORIGIN` (and `PUBLIC_API_ORIGIN`). The setup wizard never asks for it; the admin Settings page displays it **read-only** so the server manager can verify what the instance believes about itself. All absolute URLs in outbound email (invite links, item links) derive from `PUBLIC_SITE_ORIGIN` — there is no second, independently editable base-URL field to drift.
- **No build-time baking**: the frontend container entrypoint writes `/runtime-config.json` from the two origin vars at startup; the client fetches it before opening the Convex connection. A hostname change therefore never requires an image rebuild.
- **TLS**: Caddy obtains/renews certificates automatically via ACME HTTP-01 (ports 80/443 must be reachable). For dynamic-DNS hosts behind CGNAT, the documented alternative is the DNS-01 challenge with a Caddy DNS-provider plugin; the ops README carries a worked example.
- **Domain-change runbook** (a when-not-if event for the DDNS audience): edit `.env` → `docker compose up -d` → Caddy fetches the new cert; sessions are host-scoped cookies so members simply log in again; previously sent email links go stale (acceptable; invites can be resent). The frontend and backend pick up the new origins on restart with no other steps.

---

## 20. Resolved decisions (fully closed)

All v1 assumptions are now resolved by the org owner:

1. **Inbound email (IMAP)** — confirmed as specced: bounce detection + passive reply capture onto claim records; read-only, never state-changing (§13).
2. **In-app messaging** — **never**, not merely deferred (§1.2). The system manages the library and connects members with contact info; communication is the community's own affair, by whatever means makes that community better.
3. **Condition scale** — a 1–5 slider with labeled rubric, used at contribution and at every receiver confirmation; the receiver's rating is authoritative going forward.
4. **2FA** — TOTP ships in v1 alongside email OTP, with recovery codes; org-level `twoFactorPolicy` toggle per §6.2 (full-permission accounts always second-factored).
5. **Branch staging** — confirmed: parking an unclaimed item at a branch is a real custody transfer requiring host acceptance (§12).
6. **Tag governance** — confirmed: free-form entry with admin merge/rename tools, no approval gate.
7. **Queues/waitlists** — never (permanent non-goal, §1.2); **watchlists** are in scope (§9.5).

Formerly open items, now **closed** — nothing in this spec is left to implementer judgment:

- Notification preference is the single in-app/email toggle. Final for v1; no per-kind matrix.
- Condition rubric, normative wording shown at each slider stop: **5 Like new** — no visible wear · **4 Good** — minor cosmetic wear, fully functional · **3 Usable** — worn; works, quirks noted · **2 Needs repair** — not reliably usable as-is · **1 Not usable** — parts / repair project.
- Backup cadence is nightly, fixed. Orgs wanting more add their own additional `convex export` cron on the host.

## 21. Implementation phases

1. **Foundation** — compose stack, Convex schema, Convex Auth + invites, second-factor stack (TOTP + email OTP + recovery codes) with org policy, setup wizard, roles/permissions engine, settings.
2. **Circulation core** — contribution flow, catalog + search, claim/handoff protocol with photos, ledger timeline, expiry cron. *(End of phase 2 = usable library.)*
3. **Stewardship** — repair workflow, retirement workflow, status updates, watching, notifications + SMTP outbox.
4. **Branches & inbound email** — branch CRUD/pages, branch handoff modes, IMAP poll, admin queues (stuck handoffs, unmatched mail, recovery).
5. **Polish & ops** — admin audit feed, delivery log, backup/restore tooling + CI restore drill, Playwright conformance suite implementing §24 scenarios 1:1, docs (ops README, LXC guide, domain-change runbook §19.5).

---

---

## 22. Interface contract (normative)

Two agents implementing this section independently must expose the same surface. Function names, argument shapes, permission requirements, ledger effects, and error codes are binding; internal helper decomposition is free. All argument/return schemas are Zod definitions in `packages/shared`, imported by both the frontend and the Convex validators.

### 22.0 Repository layout (normative)

```
/convex            schema.ts, auth.ts, http.ts, crons.ts, domain modules (items.ts, claims.ts, branches.ts, users.ts, roles.ts, email.ts, settings.ts, watches.ts)
/apps/web          TanStack Start app (entrypoint writes /runtime-config.json, §19.5)
/packages/shared   Zod schemas + constants.ts (mirrors §23 exactly — the single source for every limit and default)
/deploy            docker-compose.yml, Caddyfile, .env.example, Makefile
```

### 22.1 HTTP actions (auth)

| Route | Body → Result | Errors |
|---|---|---|
| `POST /auth/login` | `{email, password}` → `{pendingToken}` when a second factor is required, else session cookie | `unauthenticated`, `rate_limited` |
| `POST /auth/mfa/send-otp` | `{pendingToken}` → queues email OTP | `unauthenticated`, `smtp_unconfigured`, `rate_limited` |
| `POST /auth/mfa/verify` | `{pendingToken, otp? \| totp? \| recoveryCode?}` → session cookie | `unauthenticated`, `rate_limited` |
| `POST /auth/invite/accept` | `{token, password}` → session or 2FA step per policy | `not_found` (bad/expired), `validation_failed` (weak password) |
| `POST /auth/logout` | — → clears session | — |

### 22.2 Convex function surface

Q = query (reactive, paginated where noted), M = mutation, A = action.

| Function | Kind | Args (essential) | Requires | Effects → ledger entries | Errors |
|---|---|---|---|---|---|
| `items.list` | Q pag. | `{filters: search?, categoryId?, tags?, state?, conditionMin/Max?, atBranch?, includeRetired=false}` | session | — | — |
| `items.get` / `items.ledger` | Q (pag.) | `{itemId}` | session | — | `not_found` |
| `items.contribute` | M | title, description, categoryId, tags, attributes, condition, photoIds(≥1), exchangeMode, branchId? | `items.contribute` | create AVAILABLE → `contributed` | `validation_failed` |
| `items.update` | M | `{itemId, patch}` (title/desc/category/tags/attributes/photos) | custodian + `items.update_own`, or `items.edit_any` | metadata only, no ledger | `forbidden`, `state_conflict` (retired) |
| `items.statusUpdate` | M | `{itemId, note, photoIds?}` | custodian | `status_update` | `state_conflict` |
| `items.markAvailable` | M | `{itemId, exchangeMode, branchId?}` | custodian, state IN_CUSTODY | → AVAILABLE, `marked_available` | `state_conflict` |
| `items.withdrawListing` | M | `{itemId}` | custodian, state AVAILABLE, no live claim | → IN_CUSTODY, `status_update` (system note "listing withdrawn") | `state_conflict` |
| `items.repairComplete` | M | `{itemId, note, photoIds?, newCondition}` | custodian, state UNDER_REPAIR | → IN_CUSTODY, `repair_completed` | `state_conflict` |
| `items.proposeRetirement` | M | `{itemId, reason, photoIds}` | custodian + `items.retire_propose`, no live claim | `retirement_proposed` | `state_conflict` |
| `retirements.decide` | M | `{itemId, approve, note}` | `items.retire_approve`; decider ≠ proposer unless sole approver (audited) | approve → RETIRED, `retired`; deny → `retirement_denied` | `state_conflict` (live claim), `forbidden` |
| `claims.create` | M | `{itemId, purpose}` | `items.claim`; item AVAILABLE; claimant ≠ custodian | claim pending → item CLAIMED, `claimed` | `item_not_available`, `self_claim_forbidden` |
| `claims.createStaging` | M | `{itemId, branchId}` | custodian; branch active | staging claim with branch host as receiver | `state_conflict`, `not_found` |
| `claims.confirmGiver` | M | `{claimId}` | claim's giver (custodian) | sets `giverConfirmedAt` (branch UI label: "dropped off") | `claim_wrong_party`, `claim_not_pending` |
| `claims.confirmReceiver` | M | `{claimId, photoIds(≥1), condition}` | claim's receiver | sets receiver fields; when both confirmed, finalize atomically: custody → receiver, state IN_CUSTODY/UNDER_REPAIR (staging: IN_CUSTODY under host + `placed_at_branch`), `handoff_completed`, `removed_from_branch` if applicable | `photo_required`, `claim_wrong_party`, `claim_not_pending` |
| `claims.cancel` | M | `{claimId, note?}` | claimant, item's custodian, or `claims.manage_any` | `claim_cancelled` (reason auto: `by_claimant`/`by_holder`/`admin`), item → AVAILABLE | `claim_not_pending` |
| `claims.adminResolve` | M | `{claimId, resolution: force_complete\|force_cancel, note}` | `claims.manage_any` | force_complete → claim completed + **`admin_transfer`**; force_cancel → `claim_cancelled` (admin) | `claim_not_pending` |
| `watches.toggle` | M | `{itemId}` | session | — | `not_found` |
| `branches.create` / `branches.update` | M | name, locationText, accessNotes, photos / patch, `status` | `branches.create` / host or `branches.manage_any` | deactivation blocked while any item is flagged to it | `branch_has_items`, `forbidden` |
| `categories.upsert` / `categories.archive` | M | tree ops, depth ≤ 3 | `categories.manage` | archived nodes hidden from pickers; item references retained | `validation_failed` |
| `tags.rename` / `tags.merge` | M | `{from, to}` | `categories.manage` | batch rewrite across items | — |
| `users.invite` | M+A | `{name, email}` | `users.create` | invite token (TTL §23.1), email or copyable link | `validation_failed` (dup email) |
| `users.deactivate` | M | `{userId}` | `users.manage` | auto-cancel their pending claims (`claim_cancelled`, admin); held items → recovery queue | `last_admin_protected` |
| `users.adminTransfer` | M | `{itemId, newCustodianId, note}` | `items.edit_any` **and** `claims.manage_any` | `admin_transfer` | `state_conflict` |
| `roles.upsert` / `roles.assign` | M | role doc / `{userId, roleId, remove?}` | `roles.manage` | — | `last_admin_protected`, `validation_failed` |
| `settings.update` / `settings.testSmtp` | M / A | settings patch / — | `instance.settings` | credentials encrypted before write | `validation_failed`, `smtp_unconfigured` |
| `notifications.list` / `notifications.markRead` | Q pag. / M | — / `{ids}` | session (own) | — | — |
| `me.custody` / `me.claims` / `me.watches` / `me.contributions` | Q | — | session | — | — |
| `admin.auditFeed` / `admin.emailLog` / `admin.stuckClaims` / `admin.recoveryQueue` | Q pag. | — | `instance.audit_view` / `claims.manage_any` / `users.manage` | — | `forbidden` |

### 22.3 Item action × state matrix

| Action ↓ / State → | AVAILABLE | CLAIMED | IN_CUSTODY | UNDER_REPAIR | RETIRED |
|---|---|---|---|---|---|
| `claims.create` | ✓ | — | — | — | — |
| `items.markAvailable` | — | — | ✓ | — | — |
| `items.statusUpdate` | ✓ | ✓ | ✓ | ✓ | — |
| `items.update` (metadata) | ✓ | ✓ | ✓ | ✓ | — |
| `items.repairComplete` | — | — | — | ✓ | — |
| `items.proposeRetirement` | ✓ | — | ✓ | ✓ | — |
| `retirements.decide` (approve) | ✓ | — | ✓ | ✓ | — |
| `watches.toggle` | ✓ | ✓ | ✓ | ✓ | — |
| `users.adminTransfer` | ✓ | — (cancel claim first) | ✓ | ✓ | — |

Any action attempted outside its ✓ cells fails with `state_conflict`.

### 22.4 Behavioral rulings (edge cases, binding)

- **Self-claim forbidden**: a custodian cannot claim their own AVAILABLE item (`self_claim_forbidden`); they already have it — they use `markAvailable`'s inverse, a "withdraw listing" action (sets IN_CUSTODY, writes `status_update` with system note).
- **Watching your own item** is allowed; the `watched_item_available` notification is suppressed for the actor whose action made it available.
- **No per-member claim limit**: a member may hold any number of items and pending claims.
- **Category archive** never blocks: items keep their reference; archived categories disappear from pickers and gain an "(archived)" suffix in displays.
- **Branch deactivation** is blocked while any item is flagged to the branch (`branch_has_items`); the host relocates or hands off items first.
- **Retirement approval is blocked during a live claim** (`state_conflict`); proposal during AVAILABLE is fine (the item stays claimable — a fixer claiming it implicitly argues against retirement).
- **Deactivating a member** cancels their pending claims as admin cancellations and routes their held items to the recovery queue (§6.4); their ledger history is immutable and permanent.
- **Condition only changes via rated events** (`contributed`, `handoff_completed`, `repair_completed`); `items.update` cannot touch it.
- **Timestamps** are server-assigned epoch milliseconds in every table; clients never supply times.

### 22.5 Error codes (closed enum)

`unauthenticated · forbidden · not_found · validation_failed · rate_limited · item_not_available · self_claim_forbidden · claim_not_pending · claim_wrong_party · photo_required · state_conflict · branch_has_items · last_admin_protected · smtp_unconfigured`

Every mutation failure maps to exactly one code; user-facing message strings live in the frontend (single i18n-ready map keyed by code), so backend implementations never invent copy.

---

## 23. Constants, schedules, routes & templates (normative)

### 23.1 Constants (in `packages/shared/constants.ts`; both sides import — no inline literals)

| Constant | Value |
|---|---|
| Invite token TTL | 72 h |
| `mfa_pending` token TTL | 5 min, single use |
| Email OTP | 6 digits, 10 min TTL, 5 attempts then 15-min lockout |
| Recovery codes | 10 generated, single-use, hashed; regeneration voids prior set |
| Session | 30-day rolling expiry |
| Password | min 10 chars and zxcvbn score ≥ 3 |
| `claimExpiryHours` | default 168; org-configurable 24–720 |
| Claim-expiring warning | once per claim at ≤ 24 h remaining |
| Pagination | catalog 24 / ledger timeline 50 / admin tables 50 |
| Title ≤ 120 · description ≤ 5,000 · note ≤ 2,000 chars | |
| Tags ≤ 10 × 32 chars · attributes ≤ 20 pairs (key ≤ 40, value ≤ 200) | |
| Photos | ≤ 10 per upload/ledger entry; ≤ 5 MB pre-check; `photoMaxEdgePx` 2048 |
| Category tree depth | ≤ 3 |
| Outbox | 3 attempts; backoff 1 m / 10 m / 60 m |
| Inbound email body | plaintext, ≤ 32 KB |

### 23.2 Cron schedule

| Job | Cadence |
|---|---|
| Claim expiry sweep | every 15 min |
| Claim-expiring notifier | hourly |
| Email outbox drain | every 1 min |
| IMAP poll (connect→fetch unseen→disconnect) | every 2 min |
| Orphaned-file GC | weekly, Sun 03:00 UTC |

### 23.3 Frontend routes

`/login · /setup (wizard; only when zero users) · /invite/:token · /items · /items/:id · /contribute · /me · /me/settings · /notifications · /branches · /branches/:id · /admin/members · /admin/roles · /admin/categories · /admin/claims · /admin/retirements · /admin/branches · /admin/settings · /admin/audit`

### 23.4 Email templates (subject lines normative; `{org}` = org name)

| id | Subject | Variables |
|---|---|---|
| `invite` | You're invited to {org} | name, inviteUrl, expiresAt |
| `otp` | {code} is your {org} sign-in code | code |
| `claim_placed` | [STWRD#{claimId}] {itemTitle}: claimed by {claimantName} | itemUrl, exchangeMode, contact? |
| `claim_cancelled` | [STWRD#{claimId}] {itemTitle}: claim cancelled ({reason}) | itemUrl |
| `claim_expiring` | [STWRD#{claimId}] {itemTitle}: claim expires in {hoursLeft} h | claimUrl |
| `handoff_completed` | [STWRD#{claimId}] {itemTitle}: handoff confirmed | itemUrl |
| `watched_item_available` | {itemTitle} is available | itemUrl |
| `retirement_decision` | {itemTitle}: retirement {approved\|denied} | itemUrl, note |
| `branch_item_placed` | {itemTitle} placed at {branchName} | branchUrl |
| `security_alert` | {org} account security notice | event |

The `[STWRD#{claimId}]` token (and `Reply-To` plus-address where supported) is the inbound-matching key (§13).

### 23.5 Notification payloads (per kind)

Every notification row: `{kind, payload, read}`. Payloads: claim kinds carry `{claimId, itemId, itemTitle, otherPartyName, reason?}`; `watched_item_available` carries `{itemId, itemTitle}`; `retirement_decision` carries `{itemId, itemTitle, approved, note}`; `branch_item_placed` carries `{itemId, itemTitle, branchId, branchName}`; `inbound_reply` carries `{claimId, itemId, fromName, excerpt(≤200)}`; security kinds carry `{event}`. Renderers key off `kind` alone.

---

## 24. Conformance scenarios (normative acceptance suite)

An implementation **conforms iff every scenario passes**; the Playwright suite encodes them 1:1 with stable IDs. Given/When/Then condensed.

- **C-01 Bootstrap**: fresh stack → all routes redirect to `/setup`; wizard creates server manager + settings; `/setup` then 404s.
- **C-02 Invite**: accept within TTL → account active; after 72 h → `not_found`; duplicate email invite → `validation_failed`.
- **C-03 Login (policy `required`)**: password → `pendingToken` → email OTP → session. Wrong OTP ×5 → 15-min lockout (`rate_limited`).
- **C-04 Policy `off`**: ordinary member logs in password-only; full-permission account still gets the second-factor step.
- **C-05 Recovery code**: consumes the code (reuse fails); regeneration voids the old set.
- **C-06 Claim happy path**: AVAILABLE → claim (instant) → item CLAIMED, holder notified, contact revealed per mode → both confirm (receiver blocked until photo attached) → IN_CUSTODY under claimant; ledger gains `claimed` then `handoff_completed` with photo(s) and rating.
- **C-07 Claim race**: two simultaneous `claims.create` → exactly one succeeds; the other receives `item_not_available`.
- **C-08 Photo invariant**: `confirmReceiver` without photos → `photo_required`; no code path writes `handoff_completed` with zero photos.
- **C-09 Expiry**: unconfirmed claim at T+`claimExpiryHours` → sweep cancels (`expired`), item AVAILABLE, both parties notified; warning email sent once at ≤ 24 h.
- **C-10 Expiry pause**: claim with `giverConfirmedAt` set is skipped by the sweep and appears in `/admin/claims` stuck queue after the window.
- **C-11 Admin resolve**: force-complete moves custody via `admin_transfer` (no `handoff_completed` created); force-cancel records reason `admin`.
- **C-12 Branch drop**: giver taps "dropped off" → receiver later confirms with photo → finalize writes `handoff_completed` + `removed_from_branch`.
- **C-13 Staging**: `createStaging` → host accepts as receiver with photo → item IN_CUSTODY under host + `placed_at_branch`; host's one-tap list → AVAILABLE at branch.
- **C-14 Repair cycle**: repair-purpose claim → UNDER_REPAIR → `repairComplete` raises condition → IN_CUSTODY; ledger `seq` strictly increments by 1 throughout.
- **C-15 Retirement**: propose → approve → RETIRED (terminal; hidden by default, visible with toggle). Approval during a live claim → `state_conflict`. Proposer self-approval rejected unless sole approver, and then audited.
- **C-16 Last-admin guard**: any role edit/assignment leaving zero full-permission members → `last_admin_protected`.
- **C-17 Deactivation**: member's pending claims cancelled (admin reason); held items appear in recovery queue; their ledger entries unchanged.
- **C-18 Watch**: item turns AVAILABLE → all watchers notified except the actor; watching confers no claim priority.
- **C-19 EXIF rejection**: upload carrying GPS EXIF → rejected server-side (`validation_failed`).
- **C-20 Ledger immutability**: no exposed function updates or deletes `ledgerEntries`; per-item `seq` has no gaps or duplicates after concurrent load.
- **C-21 Domain change**: editing origins in `.env` and restarting yields working app + emails with new absolute URLs, no image rebuild.

---

*End of specification v3.0.*
