# 0001 — Phase 1: Foundation

**Phase:** 1 (§21) · **Status:** 🚧 In progress
**Commits:** `c3282bd` (shared), `a915a09` (backend foundation), + ongoing

> Phase 1 scope (§21): compose stack, Convex schema, Convex Auth + invites,
> second-factor stack (TOTP + email OTP + recovery codes) with org policy, setup
> wizard, roles/permissions engine, settings.

## Completed

### `@lot/shared` — single source of truth (§22.0, §23)

Imported by both the Convex backend and the frontend; no inline literals are
permitted elsewhere.

| File | Implements | Notes |
|---|---|---|
| `constants.ts` | §23.1 | Every limit/default: token TTLs, OTP params, session, password gate, claim expiry bounds, pagination, text/tag/attribute/photo limits, outbox backoff, inbound cap. |
| `permissions.ts` | §5.2 | Closed 16-key permission catalog, `Member` baseline (✦), `isFullPermissionSet` (last-admin predicate), descriptions. |
| `enums.ts` | §7, §8, §9, §20 | Closed value sets: item/user/claim states, exchange modes, ledger entry types, notification kinds, email templates, condition rubric. |
| `errors.ts` | §22.5 | Closed error-code enum + `AppError` + `fail`/`assert` + default copy. |
| `schemas.ts` | §22.1, §22.2 | Zod argument schemas for every auth/HTTP and Convex function in the interface contract. |

**Verification:** `pnpm -F @lot/shared test` → 6 passing (catalog size = 16,
unknown-key rejection, Member baseline, full-permission predicate, claim-expiry
default, outbox backoff). `pnpm -F @lot/shared typecheck` clean.

### Convex schema (§7)

`convex/schema.ts` — full data model, **validated by deploying to a live
backend**:

- `users` (overrides `authTables.users`; app-managed fields optional so Convex
  Auth's sign-up insert is compatible — our setup/invite code defaults them),
  `roles` + `roleAssignments`, `items` (with the `search_catalog` search index
  over title + filter fields, §17), append-only `ledgerEntries`
  (`by_item_seq`), `claims`, `branches`, `categories`, `notifications`,
  `emailOutbox` + `emailInbound`, `instanceSettings` singleton, `watches`.
- Auth/2FA support tables (ours, §6.2): `mfaPending`, `twoFactor`, `emailOtp`,
  `invites`, `rateLimits`, plus `auditEvents` for the §15 audit feed.

### Authorization engine (§5.1)

`convex/lib/permissions.ts` — the single server-side enforcement boundary:

- `requireUser` (blocks `inactive` accounts, §6.4), `requirePermission`,
  `getEffectivePermissions` (union across a member's roles).
- Last-admin guard: `userIsFullPermission`, `countFullPermissionMembers`,
  `assertNotLastAdminRemoval` — the system refuses any change leaving zero
  active full-permission members.

### Secret encryption (§7.10, §18.1)

`convex/lib/crypto.ts` — AES-256-GCM via Web Crypto (runs in the Convex
isolate), key derived from `APP_SECRETS_KEY`. `encryptSecret`/`decryptSecret`
return/consume `{ciphertext, iv, tag}`.

### Settings & roles domain modules

- `convex/settings.ts`: `get` (no secrets; hostname read-only per §19.5),
  `setupStatus` (drives the `/setup` gate, C-01), `update` (encrypts SMTP/IMAP
  before write, validates claim-expiry range, audits the change).
- `convex/roles.ts`: `list`/`catalog` queries, `upsert`/`assign` mutations with
  full last-admin protection, `seedDefaultRoles` (idempotent — Server Manager =
  all permissions, Member = baseline), `myPermissions` for UI affordance gating.

### Auth wiring, HTTP, crons

- `convex/auth.config.ts` + `convex/auth.ts`: Convex Auth password provider
  (self-hosted, manual setup).
- `convex/http.ts`: registers Convex Auth routes (custom MFA actions layered
  next).
- `convex/crons.ts`: normative §23.2 cadences registered (handlers stubbed per
  phase).

### Deploy stack (§19.1)

`deploy/docker-compose.yml` (digest-pinned), `Caddyfile` (TLS + `/api` routing,
dashboard kept localhost-only), `Makefile` (up/down/admin-key/deploy/backup/
restore), `.env.example` (the §19.3 environment contract).

**Verification (live backend):** `npx tsc -p convex/tsconfig.json` clean;
`convex run settings:setupStatus` → `{hasUsers:false, setupComplete:false}`;
`convex run roles:catalog` correctly throws (unauthenticated).

## Deviations

- ⚠️ **Password hashing uses Scrypt, not Argon2id (§6.2).** Convex Auth hashes
  inside the V8 isolate, where native `@node-rs/argon2` cannot load, so the
  provider default (Scrypt via oslo) is in effect. Honoring Argon2id requires a
  WASM argon2 build wired as a custom `crypto` provider on the Password provider.
  Tracked as a Phase 1 follow-up; flagged in `convex/auth.ts`.

## Remaining for Phase 1

- [ ] Setup wizard (`/setup` bootstrap mutation/flow, §6.3): create server
      manager, name org, choose 2FA policy, set claim expiry, seed roles, write
      `instanceSettings`.
- [ ] Invite issuance + accept, linked through Convex Auth (`users.invite`,
      `/auth/invite/accept`, §6.1, §22.1).
- [ ] Second-factor elevation HTTP actions (§6.2, §22.1): `/auth/login`,
      `/auth/mfa/send-otp`, `/auth/mfa/verify`, `/auth/logout` — TOTP, email OTP,
      recovery codes, per-IP + per-account rate limiting via `X-Forwarded-For`.
- [ ] `users.deactivate` (§6.4) and the org 2FA policy enforcement (§6.2).
- [ ] `apps/web` scaffold so the setup wizard and login are reachable end-to-end.
- [ ] Argon2id follow-up (see Deviations).
