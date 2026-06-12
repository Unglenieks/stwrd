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

✅ **Phase 1 — Foundation complete.** Compose stack, Convex schema, roles/
permissions engine, settings, and the full authentication flow (setup wizard,
invites, password + second-factor elevation with TOTP / email OTP / recovery
codes) — backend verified against a live Convex backend and the auth surfaces
(`/setup`, `/login`, `/invite/:token`) verified end-to-end in a browser
(Playwright). See [`docs/devlog`](./docs/devlog/) for the implementation record.

🚧 **Phase 2 — Circulation core** in progress (5 steps): ✅ 1. Taxonomy ·
2. Media + contribution · 3. Catalog & item page · 4. Claim & handoff ·
5. Expiry cron & polish. End of phase 2 = a usable library.
