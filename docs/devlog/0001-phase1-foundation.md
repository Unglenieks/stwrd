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

### Auth flow — setup, invites, second-factor elevation (§6, §22.1)

The full authentication state machine, built on Convex Auth via a single
`ConvexCredentials` provider whose `authorize` only ever consumes a verified,
single-use completion token (`mfaPending`) and returns the userId for Convex
Auth to mint the session.

- `lib/passwordCrypto.ts`: PBKDF2-HMAC-SHA-256 hashing (isolate-safe), self-
  describing format for future upgrade.
- `lib/tokens.ts`: opaque token gen + SHA-256 hashing, uniform numeric OTP,
  recovery-code generation (unambiguous alphabet).
- `lib/totp.ts`: RFC 6238 TOTP via Web Crypto HMAC-SHA-1, ±1 step tolerance,
  base32, otpauth URI builder — no native dependency.
- `authInternal.ts`: pending/completion tokens, email-OTP issue/consume
  (5-attempt → 15-min lockout), TOTP secret staging, recovery-code consume,
  invite lookup/accept, and per-IP/per-account rate-limit counters.
- `setup.ts`: the §6.3 bootstrap wizard (`wizard` action + `assertFresh`/`finish`
  internal mutations) — creates the server manager, seeds roles, assigns Server
  Manager, writes `instanceSettings`. Refuses re-run.
- `users.ts`: `invite` (M+A), `createInvite`, `me`, `updateProfile`, `list`
  (admin members), `deactivate`/`reactivate` (last-admin-guarded).
- `twofactor.ts` + `twofactorInternal.ts`: TOTP enrollment (`startTotpEnrollment`
  → staged secret + otpauth URI; `confirmTotpEnrollment` → verify, enable, emit
  one-time recovery codes), `regenerateRecoveryCodes`, `status`.
- `http.ts`: the five §22.1 HTTP actions — `/auth/login`, `/auth/mfa/send-otp`,
  `/auth/mfa/verify`, `/auth/invite/accept`, `/auth/logout` — with
  `X-Forwarded-For` rate limiting (§18.1), CORS, and AppError→HTTP-status mapping.
- `email.ts`: outbox `enqueue` (drain action lands in Phase 3).

**Policy engine (§6.2):** `required` → always second-factored; `off` →
second factor only for voluntarily-enrolled members or full-permission accounts
once a factor is available. Bootstrap escape honored (full-permission account
with no SMTP and no TOTP logs in password-only).

**Live-backend verification:**
- `setup:wizard` → `{ok:true}`; second run → `state_conflict`; `setupStatus` →
  `{hasUsers:true, setupComplete:true}` (C-01).
- `POST /auth/login` correct password → `{status:"complete", completionToken}`;
  wrong password → `401 unauthenticated`.
- `POST /auth/mfa/verify` / `send-otp` bad token → `401`; `invite/accept` bad
  token → `404 not_found`; CORS preflight returns the expected headers.

## Deviations

- ⚠️ **Password hashing uses PBKDF2-HMAC-SHA-256, not Argon2id (§6.2).** Argon2
  has no Web Crypto primitive and native/WASM builds don't load in the Convex V8
  isolate where hashing runs. PBKDF2 (210k iterations, FIPS-grade) is the
  isolate-safe substitute; the stored format is self-describing so a future WASM
  Argon2id can re-hash transparently on next login. Documented in
  `lib/passwordCrypto.ts`. (Supersedes the earlier "Scrypt default" note — we now
  control hashing explicitly via the credentials provider's `crypto` option.)
- ⚠️ **Session mint is a second client call (§22.1).** `/auth/login` returns a
  `completionToken` rather than directly setting a session cookie; the frontend
  exchanges it via Convex Auth's `signIn("credentials", {completionToken})` so
  the React client manages tokens natively. The spec's intent — HTTP actions for
  IP-aware rate limiting and a token (not a session) between factors — is
  preserved.

## Remaining for Phase 1

- [x] `apps/web` scaffold with `/setup`, `/login`, `/invite/:token` reachable
      end-to-end — see [devlog 0002](0002-phase1-frontend.md) (4/4 Playwright
      smoke tests green against the live backend).

Carried forward (not blocking Phase 1 completion):

- [ ] Argon2id WASM follow-up (see Deviations).
- [ ] Claim-cancellation on deactivation wires in with the claims module (Phase 2).
- [ ] Interactive TOTP-enrollment screen + dedicated `/healthz` (Phase 2 UI).
