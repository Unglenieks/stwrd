# Architecture

## System overview

Stwrd is a three-service application behind a Caddy reverse proxy, packaged as a Docker Compose stack. All persistent state lives in the Convex backend volume.

```
Browser ──▶ Caddy (:80/:443, TLS)
              ├─ /api/*  ──▶ Convex backend (:3210, client WebSocket + HTTP)
              └─ /*      ──▶ Frontend (:3000, TanStack Start SSR)
                                └─ WebSocket ──▶ Convex backend (:3210)

Convex backend (:3211, HTTP actions) ──────────▶ SMTP/IMAP (org-owned mailbox)
Convex dashboard (:6791, localhost-only) ──────▶ Convex backend
```

## Services

### Convex backend

Image: `ghcr.io/get-convex/convex-backend` (pinned by digest in `deploy/docker-compose.yml`).

Responsibilities:
- Reactive database (SQLite default; Postgres via `POSTGRES_URL`)
- TypeScript mutations, queries, and actions (all in `/convex/`)
- Built-in file storage (item photos, branch photos, handoff photos)
- Scheduled jobs (crons): claim expiry, email drain, IMAP poll
- HTTP actions on `:3211`: JWKS endpoint, `/auth/*` endpoints, EXIF-stripping file upload proxy

State persists to a named Docker volume (`data`). A backup is `npx convex export` (consistent snapshot of all tables and file storage). See `docs/ops-README.md`.

Ports:
- `:3210` — Convex client API (WebSocket for reactive queries, HTTP for mutations/actions)
- `:3211` — Convex HTTP actions (auth flows, JWKS, file upload)

Both ports are bound to `127.0.0.1` in the compose file; Caddy routes them.

### Frontend

Built from `apps/web/Dockerfile`. Node 22 running the TanStack Start SSR output (`.output/server/index.mjs`).

The container entrypoint (`apps/web/docker-entrypoint.sh`) writes `PUBLIC_API_ORIGIN` and `PUBLIC_CONVEX_SITE_ORIGIN` to `/runtime-config.json` at startup. The client-side code fetches this file before establishing the Convex WebSocket connection. This is the runtime-config pattern: the domain can change without rebuilding the image.

### Convex dashboard

Image: `ghcr.io/get-convex/convex-dashboard` (pinned by digest). Bound to `127.0.0.1:6791`. Operator infrastructure tool — table viewer, function logs, manual mutation runner. Never route publicly.

### Caddy

Routes the single public hostname: `/api/*` → backend `:3210`, everything else → frontend `:3000`. Handles TLS via ACME HTTP-01 (Let's Encrypt). Configuration in `deploy/Caddyfile`.

For CGNAT or dynamic-DNS deployments, use the DNS-01 challenge with a Caddy DNS-provider plugin.

## Request flow

### Page load

1. Browser requests `https://your-domain/` → Caddy → Frontend SSR (Node 22)
2. Frontend renders initial HTML; auth gate checks session cookie
3. Unauthenticated requests redirect to `/login`
4. After render, browser opens WebSocket to `https://your-domain/api` → Caddy → Convex backend `:3210`
5. Convex reactive queries push live updates over the WebSocket

### Photo upload

1. Frontend calls `storage.generateUploadUrl` (Convex query) → returns short-lived upload URL pointing to `:3211`
2. Browser POSTs the file directly to the Convex HTTP action endpoint (`/api/upload-photo`)
3. HTTP action strips EXIF/GPS metadata before writing to Convex file storage
4. Action returns the `_storage` ID
5. Frontend passes the ID to the mutation that records it (e.g., `items.contribute`, `claims.confirmReceiver`)

### Email outbound

1. A mutation calls a helper in `email.ts` that writes a row to `emailOutbox` (state: `queued`)
2. A 1-minute cron triggers `emailDrain.ts`, which calls an action
3. The action reads queued rows, sends via SMTP (Nodemailer), updates the row state to `sent` or `failed`
4. Failed rows retry with exponential backoff up to 3 attempts
5. The `emailOutbox` table doubles as the delivery log visible in Admin → Delivery log

### Inbound email

1. A 2-minute cron triggers `imapPoll.ts`, which calls an action
2. The action connects via IMAP (ImapFlow), fetches unseen messages since the last seen UID
3. `inbound.ts` classifies each message: reply (matched to a claim via plus-address or `[STWRD#id]` token), bounce, or unmatched
4. Results are written to `emailInbound`; reply bodies are linked to the relevant claim

## Tech stack

| Layer | Technology |
|---|---|
| Backend platform | Convex (self-hosted, open source, TypeScript, strict mode) |
| Frontend framework | TanStack Start (React, SSR) + TanStack Router / Query / Form |
| UI components | shadcn/ui on Tailwind CSS |
| Authentication | Convex Auth (password provider) + custom 2FA layer |
| Shared validation | Zod (same schemas used on client and server, in `/packages/shared`) |
| Outbound email | Nodemailer (via Convex action) |
| Inbound email | ImapFlow IMAP client (via Convex action) |
| Package manager | pnpm (workspace) |
| Tests | Vitest + convex-test (backend unit/conformance), Playwright (end-to-end) |

## Why these choices

**Convex as the only backend.** All business logic lives in TypeScript functions co-located in `/convex/`. There is no separate API server. Ledger appends and item state transitions are atomic within a single mutation — no application-layer locking, no race conditions.

**Append-only ledger.** `ledgerEntries` is write-once. The helper in `convex/lib/ledger.ts` enforces the monotonically-increasing `seq` invariant. Corrections are new entries (`annotation` type with `correctsSeq`), never edits. This is a deliberate design goal: the ledger must be evidence-grade within the community's trust model.

**Runtime-config pattern.** The frontend image never bakes in environment-specific URLs. `docker-entrypoint.sh` writes them to `runtime-config.json` at startup. This means a domain change requires only an env edit and container restart — no rebuild, no redeployment of the frontend image.

**No due dates or queue management.** Permanent non-goals per the spec (§1.2). Custody is indefinite. The expiry cron only cancels uncompleted claims, not long-held custody.

**SQLite default.** The right operational weight for a community org. Single-node, no external database dependency. Postgres is available via `POSTGRES_URL` for larger installs.
