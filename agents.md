# Stwrd — agent navigation guide

This document is the entry point for an AI agent working in this codebase. Read it first, then follow links into `docs/` for detail. It tells you what the system does, how it is structured, where the key invariants live, and what to watch out for.

---

## What this system does

Stwrd is a community item-sharing platform. The core organizing principle is **custody**: every non-retired item is in exactly one member's care at all times. Members claim items, complete two-party photo-verified handoffs, log repairs, and propose retirements. An append-only ledger records every event in an item's history. There are no due dates, no fines, and no queue management.

One organization per installation. All routes require authentication. The server-manager is the bootstrap superuser role.

---

## Repository map

```
/convex/                     Convex backend — all server-side logic
  schema.ts                  Database schema (all tables, indexes, validators)
  auth.ts                    Authentication entry point (Convex Auth)
  auth.config.ts             Auth provider config (password, email OTP)
  authInternal.ts            Internal auth helpers (2FA gate, session creation)
  http.ts                    HTTP actions (JWKS, /auth/* endpoints, file upload proxy)
  crons.ts                   Scheduled jobs (claim expiry sweep, email drain, IMAP poll)

  items.ts                   Item CRUD, EXIF-stripped photo upload, search
  claims.ts                  Claim lifecycle (create, giver-confirm, receiver-confirm, cancel, force)
  catalog.ts                 Catalog read queries + full-text search
  me.ts                      Member self-service (held items, active claims, watches)
  users.ts                   Member management (invite, activate, deactivate, role assignment)
  roles.ts                   Role + permission management
  settings.ts                Instance settings (org config, SMTP/IMAP, appearance)
  setup.ts                   One-time bootstrap wizard (creates first account + roles)
  notifications.ts           Notification CRUD + delivery routing decisions
  watches.ts                 Watch CRUD + fan-out to watchers on item-available
  branches.ts                Branch CRUD + item placement at branch
  stewardship.ts             Repair start/complete + status updates
  retirements.ts             Retirement propose, approve, deny
  categories.ts              Category tree management (depth ≤ 3)
  tags.ts                    Tag management
  storage.ts                 File storage (generate upload URLs, generate serve URLs)
  admin.ts                   Admin queries (audit feed, delivery log, stuck handoff queue, recovery queue)
  email.ts                   Outbound email templates + writes to emailOutbox
  emailDrain.ts              Action: drains emailOutbox via SMTP (called by 1-min cron)
  imapPoll.ts                Action: polls IMAP for replies and bounces (called by 2-min cron)
  inbound.ts                 Inbound email classification (reply / bounce / unmatched / UID-dedupe)
  twofactor.ts               2FA enrollment + verification (TOTP, email OTP, recovery codes)
  twofactorInternal.ts       Internal 2FA helpers shared across auth modules

  lib/
    ledger.ts                Append-only ledger write helper — THE ONLY PATH to insert ledger entries
    permissions.ts           requirePermission(ctx, userId, permission) helper
    crypto.ts                AES-GCM encryption/decryption for secrets at rest (APP_SECRETS_KEY)

/apps/web/                   Frontend — TanStack Start (React, SSR)
  src/
    routes/
      __root.tsx             Root layout: auth gate, navigation shell
      index.tsx              Catalog home (search, browse)
      items.index.tsx        Item list
      items.$id.tsx          Item detail + ledger timeline
      contribute.tsx         Contribution form (title, photos, category, condition)
      me.index.tsx           My library (items in my care, my active claims)
      notifications.index.tsx  Notification inbox (in-app + email status)
      branches.index.tsx     Branch directory
      branches.$id.tsx       Branch detail + items at branch
      login.tsx              Login form + 2FA challenge
      setup.tsx              Setup wizard (first-time only)
      invite.$token.tsx      Invite acceptance flow
      admin.settings.tsx     Admin: org settings, SMTP/IMAP config, test email
      admin.claims.tsx       Admin: stuck handoffs, custodian-inactive recovery queue
      admin.audit.tsx        Admin: audit feed + delivery log
    components/              Shared React components
    lib/                     Frontend utilities (Convex client config, auth helpers)
    styles/                  Global CSS (Tailwind base + shadcn tokens)

/packages/shared/
  src/
    enums.ts                 Enum value sets (itemState, ledgerType, claimState, etc.)
    schemas.ts               Zod schemas for form validation and API types
    constants.ts             Limits and defaults (max photo size, claim expiry bounds, etc.)

/deploy/
  docker-compose.yml         Reference stack (backend, dashboard, frontend, proxy)
  Caddyfile                  Caddy reverse proxy config (TLS, routing)
  Makefile                   Operational commands (deploy, backup, restore, env-set-secret)
  .env.example               Full environment variable documentation
  docker-compose.quickstart.yml  Localhost stack (HTTP only) — also the local agent build
  Caddyfile.local            HTTP-only proxy config for the localhost compose files
  quickstart-smoke.sh        Start the quickstart stack, verify it end to end, tear down
  restore-drill.sh           Backup → restore → verify script (runs in CI)

/.forgejo/workflows/
  ci.yml                     CI: typecheck, unit tests, frontend build, backup/restore drill
  quickstart.yml             Quickstart smoke: build + bootstrap the localhost stack, check login
```

---

## Code hosting and CI

- **Origin is Forgejo:** `ssh://git@git.home.unglenieks.com:2222/Unglenieks/stwrd.git` (web: https://git.home.unglenieks.com/Unglenieks/stwrd). Push branches there and open pull requests on Forgejo (web UI or `POST /api/v1/repos/Unglenieks/stwrd/pulls`). Do not use `gh`.
- **GitHub (`github.com/Unglenieks/stwrd`) is a read-only mirror**, synced from Forgejo every ~2 minutes. Never push to it; agent clones keep a `github` remote with pushes disabled.
- **CI is Forgejo Actions** on the fleet runner (`.forgejo/workflows/`). GitHub Actions no longer runs. Both workflows run on pull requests; `ci.yml` also runs on `main`, weekly, and on dispatch.
- **Checking CI (agents on Shipyard)** with `fleet-ci`:

  ```sh
  fleet-ci runs stwrd               # recent runs: number, status, event, workflow, branch, title
  fleet-ci wait stwrd [run]         # block until done; exit 0 only on success
  fleet-ci logs stwrd <run> [job]   # job logs (job index 0, 1, ...)
  fleet-ci dispatch stwrd ci.yml [ref]
  fleet-ci url stwrd [run]          # link for a human
  ```

  The runner is shared and runs 2 jobs at a time, so runs may sit in `waiting` for a while.
- **Deployment:** there is none from this repo. Stwrd is self-hosted by each organization from `deploy/`; no Railway, Vercel or Convex Cloud project exists. For a running build to test against, see [`docs/local-environments.md`](./docs/local-environments.md).

---

## Invariants you must not violate

**Ledger writes go through `convex/lib/ledger.ts` only.** Never insert into `ledgerEntries` directly from a mutation. The helper enforces monotonically increasing `seq` per item. The ledger is append-only; there is no update or delete path.

**One active claim per item.** A claim in state `pending`, `giver_confirmed`, or `receiver_confirmed` is "active." The `claims.ts` mutation that creates a claim checks for an existing active claim on the same item and throws if one exists. This is the only enforcement point.

**Item state mirrors claim state.** When a claim is created, the item moves to `claimed`. When a handoff completes, the item moves to `in_custody`. When a claim is cancelled, the item returns to `available`. These transitions happen in the same mutation as the claim state change — they are not eventually consistent.

**Receiver photo is required to complete a handoff.** `confirmReceiver` in `claims.ts` will throw `photo_required` if `receiverPhotoIds` is empty. There is no admin path around this (force-complete uses `admin_transfer`, which does not require a photo but writes a different ledger type).

**`custodianId` on items is denormalized truth-of-now.** The ledger is truth-of-history. Both must be updated together in any custody-changing mutation.

**Encrypted secrets use `APP_SECRETS_KEY`.** SMTP/IMAP passwords and TOTP secrets are AES-GCM encrypted before storage. The key is a Convex deployment env var (not a container env var). Never store credentials as plaintext. The encrypt/decrypt helpers are in `convex/lib/crypto.ts`.

**`searchText` must be maintained.** It is a denormalized concatenation of `title + description + tags` used by the Convex search index. Every mutation that touches these fields must update `searchText`.

**The server-manager role cannot be left empty.** `convex/users.ts` has a last-admin guard: a deactivation or role-removal that would leave zero server-manager accounts throws `last_admin_protected`.

---

## Key patterns

### Permission checks

```typescript
import { requirePermission } from "./lib/permissions";
// Inside a mutation:
await requirePermission(ctx, userId, "items.contribute");
```

Permission strings are defined in `packages/shared/constants.ts`. Roles are stored in the `roles` table; assignments in `roleAssignments`.

### Ledger appends

```typescript
import { appendLedger } from "./lib/ledger";
await appendLedger(ctx, itemId, {
  type: "handoff_completed",
  actorId,
  counterpartyId,
  claimId,
  photoFileIds,
  conditionRating,
  createdAt: Date.now(),
});
```

The helper reads the current `ledgerSeq` from the item, increments it, writes the entry, and updates `item.ledgerSeq` — atomically within the mutation.

### Email queuing

Mutations never send email directly. They call a helper in `email.ts` that writes to `emailOutbox`. The `emailDrain` cron action picks up queued rows every minute.

### File uploads

The frontend calls `storage.generateUploadUrl` (a Convex query) to get a short-lived upload URL, POSTs the file directly to the Convex HTTP action endpoint, then passes the returned `_storage` ID to the mutation. EXIF metadata is stripped server-side in the HTTP action before storage.

---

## Cron schedule

| Job | Interval | File |
|---|---|---|
| Claim expiry sweep | Every 30 min | `crons.ts` → `claims.ts:sweepExpiredClaims` |
| Email drain | Every 1 min | `crons.ts` → `emailDrain.ts:drainEmailOutbox` |
| IMAP poll | Every 2 min | `crons.ts` → `imapPoll.ts:pollImap` |

---

## Docs index

| Document | Contents |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | System components, data flow, tech decisions |
| [`docs/data-model.md`](./docs/data-model.md) | All tables, fields, indexes, and invariants |
| [`docs/workflows.md`](./docs/workflows.md) | Item and claim state machines, key business flows |
| [`docs/auth.md`](./docs/auth.md) | Auth system, 2FA, roles, permissions |
| [`docs/ops-README.md`](./docs/ops-README.md) | Operations: first run, backup, upgrades |
| [`docs/domain-change.md`](./docs/domain-change.md) | Hostname and TLS change runbook |
| [`docs/lxc.md`](./docs/lxc.md) | LXC hosting guide |
| [`docs/conformance.md`](./docs/conformance.md) | §24 test suite — scenario-to-test mapping |
| [`docs/local-environments.md`](./docs/local-environments.md) | Running a testable build locally / on the fleet (agent builds) |
