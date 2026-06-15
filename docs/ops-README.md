# Operations guide

How a server manager runs a Stwrd instance. One technical volunteer should be able to
operate it. See [`spec.md`](../spec.md) §19 for the normative deployment contract.

## Stack

Four containers, one Compose stack ([`deploy/docker-compose.yml`](../deploy/docker-compose.yml)):

| Service | Port | Notes |
|---|---|---|
| `backend` | 3210 (API), 3211 (HTTP actions) | self-hosted Convex; SQLite by default, Postgres via `POSTGRES_URL` |
| `dashboard` | 6791 (localhost only) | operator console; **never expose publicly** |
| `frontend` | 3000 | TanStack Start (Node 22) |
| `proxy` | 80/443 | Caddy — TLS + routing |

Images are pinned **by digest** (§18.1).

## First run (§19.2)

```bash
cd deploy
cp .env.example .env          # fill in domain + generated secrets (see below)
docker compose up -d          # bring up the stack

# 1. Generate the admin key (store it in your password manager).
make admin-key                # → docker compose exec backend ./generate_admin_key.sh

# 2. Deploy the Convex functions/schema and set the function-side secret.
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key>
make deploy                                   # npx convex deploy
make env-set-secret KEY="$(openssl rand -base64 32)"   # APP_SECRETS_KEY (§19.1)

# 3. Also set the Convex Auth signing keys (one-time), then redeploy:
#    npx convex env set JWT_PRIVATE_KEY "<pkcs8>"   (spaces, not newlines)
#    npx convex env set JWKS "<jwks json>"
#    npx convex env set SITE_URL "https://library.example.org"
```

Then visit the site → the **setup wizard** (`/setup`, shown only while zero users
exist): create the server-manager account, name the org, choose the 2FA policy,
set the claim-expiry default, optionally configure SMTP/IMAP.

### Secrets to generate for `.env`

| Var | How |
|---|---|
| `INSTANCE_NAME` | `openssl rand -hex 6` |
| `INSTANCE_SECRET` | `openssl rand -hex 32` |
| `APP_SECRETS_KEY` (Convex env, not `.env`) | `openssl rand -base64 32` |

`PUBLIC_SITE_ORIGIN` / `PUBLIC_API_ORIGIN` / `CONVEX_SITE_ORIGIN` /
`PUBLIC_CONVEX_SITE_ORIGIN` are the hostname contract — see
[`domain-change.md`](./domain-change.md). **`CONVEX_SITE_ORIGIN` is the backend
HTTP-actions origin (where `/.well-known/jwks.json` and `/auth/*` live), not the
frontend URL.**

## Email

The server manager connects an **org-owned mailbox** under **Admin → Settings**
(host/port/TLS/username/app-password — stored encrypted, §7.10), with a
**Send test email** button. Outbound is an outbox drained by a 1-min cron;
inbound (replies + bounces) is polled by IMAP every 2 min (§13).

> Note: once SMTP or TOTP is available, full-permission (server-manager) accounts
> are **always** required to use a second factor (§6.2) — the keys to the instance
> never ride on a single password.

## Backup & restore (§18.4)

- **Nightly backup** (host cron): `make backup` → `npx convex export` (a consistent
  snapshot of all tables **and** file storage). Retain 14 daily / 8 weekly.
- **Restore**: `make restore SNAPSHOT=<file.zip>` → `npx convex import --replace`
  into a fresh stack.
- **Restore drill**: [`deploy/restore-drill.sh`](../deploy/restore-drill.sh)
  exports → restores → verifies; it runs in CI against a seeded instance
  (`.github/workflows/ci.yml`).
- Do **not** live-copy the SQLite volume — stop the backend or use a filesystem
  snapshot first.

## Observability (§18.5)

- Backend: `GET /version` (built-in). Convex dashboard has function logs/metrics.
- Frontend: the container healthcheck hits `/` (returns 200 when up). _Known
  deviation: the spec names `/healthz`; this Start version doesn't expose custom
  server routes the way we tried, so `/` is the health probe for now._
- Frontend logs to stdout.

## Upgrades (§19.4)

Pinned image tags are bumped via tagged releases; `npx convex deploy` pushes
function/schema changes (Convex schema validation gates incompatible changes).
