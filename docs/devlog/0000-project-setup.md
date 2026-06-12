# 0000 — Project setup & environment

**Date:** 2026-06-11 → 2026-06-12
**Status:** ✅ Done
**Commit:** `c3282bd` (skeleton) and surrounding environment setup

## Goal

Initialize the repository and stand up a working local development environment
for the Convex-based stack so that subsequent backend work can be type-checked
and smoke-tested against a real backend.

## What was done

### Repository

- `git init -b main`; `core.autocrlf=false`.
- Monorepo laid out to the **normative §22.0 structure**:
  ```
  /convex          Convex functions (schema, auth, domain modules) — project root IS repo root
  /apps/web        TanStack Start frontend (scaffolded next)
  /packages/shared Zod schemas + constants (single source of truth)
  /deploy          docker-compose.yml, Caddyfile, .env.example, Makefile
  /docs            documentation + this devlog
  ```
- `.gitignore` (Node/Convex/env/editor); `README.md`; `pnpm-workspace.yaml`;
  `tsconfig.base.json`.
- **pnpm** installed globally via `npm install -g pnpm@9` (corepack was not
  available on the host).

### Local Convex backend (spec-canonical, §19)

- `deploy/docker-compose.yml` brings up the self-hosted Convex backend, dashboard,
  frontend, and a Caddy proxy. **Images are pinned by digest** (§18.1):
  - backend `@sha256:edd7959f…` (revision `9c73f185`)
  - dashboard `@sha256:bbc4d2c4…`
- For local development only the `backend` service runs:
  `cd deploy && docker compose up -d backend`.
- `deploy/.env` holds local values (origins → `localhost`, generated
  `INSTANCE_SECRET`). Gitignored.
- Admin key generated with `docker compose exec backend ./generate_admin_key.sh`,
  stored in repo-root `.env.local` as `CONVEX_SELF_HOSTED_URL` +
  `CONVEX_SELF_HOSTED_ADMIN_KEY` (gitignored) — the Convex CLI reads these.

### Convex Auth deployment secrets (§4, §6, §18.1)

Generated an RS256 keypair (via `jose`) and set deployment env vars on the
backend with `npx convex env set`:

- `JWT_PRIVATE_KEY`, `JWKS` — Convex Auth session signing / JWKS publication.
- `SITE_URL` = `http://localhost:3000`.
- `APP_SECRETS_KEY` — AES key material for at-rest encryption of SMTP/IMAP creds
  and TOTP secrets (`openssl rand -base64 32`).

## Verification

- Backend reports healthy (`docker inspect … .State.Health.Status` → `healthy`;
  `GET /version` 200).
- `npx convex codegen` succeeds against the backend and writes
  `convex/_generated/`.
- `npx convex deploy -y` finalizes functions; schema validation passes.

## Notes / gotchas

- **Codegen vs deploy:** `convex codegen` generates types but does **not** make
  functions runnable via `convex run`. A full `npx convex deploy` is required
  before `convex run <fn>` works. (Codegen does push for analysis, but `run`
  needs the finalized deploy.)
- **Codegen requires a live backend** — there is no offline codegen. This is why
  the Docker backend is part of the dev loop.
- `CONVEX_TMPDIR` is set to a repo-local `.convex-tmp/` because `/tmp` is on a
  different filesystem (codegen warns otherwise). `.convex-tmp/` is gitignored.
- `REDACT_LOGS_TO_CLIENT` is parameterized in compose (`:-true`); set it to
  `false` locally to surface function error details while debugging.
- `convex/_generated/` **is committed** (Convex-recommended; required for CI
  typecheck without a live backend).
