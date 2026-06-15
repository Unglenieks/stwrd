# Distributed Library of Things

A self-hostable web application that lets a community organization run a "library of things"
with **no central physical collection**. Items live with members; custody — not shelving — is
the organizing principle. Every item is in the care of exactly one member at all times, and an
append-only ledger records every change of hands, repair, and condition observation across the
item's life.

See [`spec.md`](./spec.md) for the full normative technical specification (v3.0).

## Architecture

Three services, one Docker Compose stack:

- **convex-backend** — self-hosted [Convex](https://www.convex.dev/) (reactive DB, serverless
  functions, file storage, crons, HTTP actions). SQLite by default; optional Postgres.
- **convex-dashboard** — operator admin console (localhost-bound by default).
- **frontend** — [TanStack Start](https://tanstack.com/start) (React, SSR) connecting over WebSocket.

A Caddy reverse proxy terminates TLS and routes a single public hostname.

## Repository layout (spec §22.0)

```
/convex            schema.ts, auth.ts, http.ts, crons.ts, domain modules
/apps/web          TanStack Start app
/packages/shared   Zod schemas + constants.ts (single source for limits & defaults)
/deploy            docker-compose.yml, Caddyfile, .env.example, Makefile
/docs              ops README, LXC guide, domain-change runbook
```

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Convex (self-hosted, TypeScript, strict mode) |
| Frontend | TanStack Start + TanStack Router/Query/Form |
| UI | shadcn/ui on Tailwind CSS |
| Auth | Convex Auth (password) + TOTP / email OTP / recovery codes |
| Validation | Zod (shared client + server schemas) |
| Email | Nodemailer (out) / ImapFlow (in) via Convex actions |
| Tooling | pnpm, Vitest, Playwright, ESLint + Prettier |

## Implementation phases (spec §21)

1. **Foundation** — compose stack, schema, auth + 2FA, setup wizard, roles/permissions, settings.
2. **Circulation core** — contribution, catalog + search, claim/handoff with photos, ledger, expiry cron.
3. **Stewardship** — repair, retirement, status updates, watching, notifications + SMTP outbox.
4. **Branches & inbound email** — branch CRUD/pages, branch handoffs, IMAP poll, admin queues.
5. **Polish & ops** — audit feed, delivery log, backup/restore + CI restore drill, Playwright suite, docs.

## Status

**All five spec phases are complete.** See [`docs/devlog`](./docs/devlog/) for the
per-phase implementation record (what was built, verification evidence, and any
deviations from the spec), the [conformance map](./docs/conformance.md) (§24
C-01…C-21 → tests), and the [operations guide](./docs/ops-README.md).

| Phase | Status |
|---|---|
| 1 · Foundation — compose stack, schema, roles/permissions, settings, auth (setup wizard, invites, TOTP / email-OTP / recovery 2FA) | ✅ |
| 2 · Circulation core — contribution (camera → EXIF-stripped upload), catalog + search, claim & two-party photo handoff, ledger timeline, expiry crons, "My library" | ✅ |
| 3 · Stewardship — repair + retirement workflows, watching, notifications inbox, SMTP outbox (Nodemailer, retry/backoff) | ✅ |
| 4 · Branches & inbound email — branch drop points + staging, branch handoffs, IMAP poll (reply capture + bounce detection), admin queues (stuck handoffs, recovery) | ✅ |
| 5 · Polish & ops — audit-feed + delivery-log UI, backup/restore + CI restore drill, §24 conformance suite, ops/LXC/domain-change docs | ✅ |

**What a member can do:** sign in (policy-driven 2FA), browse/search the catalog,
contribute items, claim and complete a **two-party photo-verified handoff** that
moves custody, follow each item's **immutable ledger timeline**, log repairs,
propose/approve retirement, watch items, drop off / pick up / stage at
**member-hosted branches**, receive **email notifications** (reply capture +
bounce detection via IMAP), and manage everything from **My library** — with
automatic claim expiry, an admin **audit & delivery log**, and queues for stuck
handoffs and custodian-inactive recovery.

### Verification

Exercised by **52 Convex unit/conformance tests** (convex-test, in-process) and
**11 Playwright end-to-end tests** driving the real UI against the live
self-hosted backend — including a two-account driveway handoff, real SMTP
delivery to a mailpit catcher, the branch flow, and the §24 acceptance scenarios.
CI (`.github/workflows/ci.yml`) runs typecheck + unit tests + a **backup/restore
drill** against a throwaway backend.

```bash
pnpm test:convex                            # backend unit + conformance tests
cd apps/web && pnpm exec playwright test    # e2e (needs the local stack + mailpit)
```
