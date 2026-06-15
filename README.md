# Stwrd

Everything here is in someone's care.

Stwrd is a self-hosted web application for community organizations that share tools, equipment, and other things. There is no warehouse, no due dates, and no waiting list. Every item in the catalog is in a member's care at all times. When someone wants it, they arrange a handoff directly with the person looking after it. The record keeps itself.

Designed for churches, co-housing groups, land trusts, tool libraries, and any organization where responsibility is already part of the culture.

---

## How it works

A member contributes something they are willing to share. The item enters the catalog, still in their care. When another member wants it, they claim it. The two of them arrange a physical exchange and confirm it in the app — each on their own device, with a photo from the receiver. Custody moves. The record updates. The item is now in the new member's care.

No central drop-off. No overdue notices. No queue politics. If you are looking after something and you want to pass it along, you arrange it with the next person directly.

---

## Features

- **Catalog with full-text search** — browse by category, condition rating, and keyword. Members only; no public access by design.
- **Two-party photo handoff** — every change of custody requires confirmation from both the giver and the receiver, with a photo taken by the receiver.
- **Immutable ledger** — every event in an item's life is recorded and cannot be altered. Corrections are new entries.
- **Repair workflow** — a member can take an item into their care specifically to fix it. The next person sees what was done.
- **Branches** — member-hosted drop points for contactless exchanges: a porch box, a garden shed, a building lobby.
- **Watching** — follow an item and receive a notification when it becomes available.
- **Two-factor authentication** — TOTP, email OTP, or recovery codes. The policy is configurable per organization.
- **Email notifications** — sent through an org-owned mailbox; email replies are captured and linked to the relevant handoff.
- **Fully self-hosted** — your organization's data lives on your server. No cloud accounts required at runtime.

---

## Prerequisites

- Docker and Docker Compose (v2)
- A domain name pointing to your server
- Ports 80 and 443 open (for automatic TLS via Let's Encrypt)
- Node 22 (for deploying Convex functions; only needed during setup)
- pnpm 9 (same — only needed during setup)

---

## Deployment

### 1. Get the code

```bash
git clone https://github.com/Unglenieks/stwrd.git
cd stwrd
```

### 2. Configure your environment

```bash
cd deploy
cp .env.example .env
```

Edit `.env`. The values you must set:

| Variable | How to set it |
|---|---|
| `PUBLIC_SITE_ORIGIN` | Your public URL: `https://stwrd.example.org` |
| `PUBLIC_API_ORIGIN` | Convex client API origin: `https://stwrd.example.org/api` |
| `CONVEX_SITE_ORIGIN` | Backend HTTP-actions origin (auth endpoints, JWKS). Must route to the backend's `:3211` port. Use a subdomain: `https://api.stwrd.example.org` |
| `PUBLIC_CONVEX_SITE_ORIGIN` | Same as above (browser-facing) |
| `PROXY_HOSTNAME` | Just the hostname: `stwrd.example.org` |
| `ACME_EMAIL` | An email address for Let's Encrypt certificate notices |
| `INSTANCE_NAME` | `openssl rand -hex 6` |
| `INSTANCE_SECRET` | `openssl rand -hex 32` |

> `CONVEX_SITE_ORIGIN` is the backend's own HTTP-actions origin, not the frontend URL. Pointing it at the frontend will break authentication. See [`docs/domain-change.md`](./docs/domain-change.md) for a full explanation of the origin variables.

### 3. Start the stack

```bash
docker compose up -d
```

This starts four containers: the Convex backend, the Convex dashboard (localhost-only admin console), the frontend, and Caddy (handles TLS automatically).

Wait for all containers to report healthy:

```bash
docker compose ps
```

### 4. Generate the admin key

```bash
docker compose exec backend ./generate_admin_key.sh
```

Save the output in your password manager. You will need it to operate the instance.

### 5. Deploy the backend functions

From the repository root:

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key from step 4>

cd deploy
make deploy
```

### 6. Set the encryption key

```bash
make env-set-secret KEY="$(openssl rand -base64 32)"
```

This sets `APP_SECRETS_KEY` in the Convex deployment environment. It encrypts SMTP and IMAP credentials and TOTP secrets at rest. Generate it once; if you change it, stored credentials will need to be re-entered.

### 7. Set the auth signing keys

Convex Auth requires a JWT key pair. Generate one and set it:

```bash
npx convex env set JWT_PRIVATE_KEY "<pkcs8-private-key>"
npx convex env set JWKS "<jwks-json>"
npx convex env set SITE_URL "https://stwrd.example.org"
```

For key generation instructions, see the [Convex Auth setup guide](https://labs.convex.dev/auth/setup/manual).

### 8. Complete the setup wizard

Visit your domain. The setup wizard appears automatically the first time (while no accounts exist). Create the server-manager account, name the organization, choose the two-factor policy, and set a default handoff-expiry window. SMTP email is optional but recommended.

---

## First-run checklist

- [ ] `.env` set: domain, `INSTANCE_NAME`, `INSTANCE_SECRET`, `ACME_EMAIL`
- [ ] `docker compose up -d` — all four containers healthy
- [ ] Admin key generated and saved securely
- [ ] `make deploy` completed successfully
- [ ] `APP_SECRETS_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` set in Convex env
- [ ] Setup wizard completed at your domain
- [ ] (Optional) SMTP configured under Admin → Settings, test email sent
- [ ] (Optional) IMAP configured for reply capture

---

## Operations

### Backups

Run nightly as a host cron:

```bash
cd deploy && make backup
```

This calls `npx convex export` and produces a consistent snapshot of all data and file storage. Keep 14 daily and 8 weekly copies. To restore from a snapshot:

```bash
make restore SNAPSHOT=<snapshot-file.zip>
```

A restore drill script runs automatically in CI against a seeded instance to verify the backup path is working.

### Domain changes

Edit the origin variables in `deploy/.env`, then:

```bash
docker compose up -d
```

No image rebuild is needed. If `CONVEX_SITE_ORIGIN` changed, also run `make deploy` to update the baked auth issuer. Full runbook: [`docs/domain-change.md`](./docs/domain-change.md).

### Upgrades

Bump the pinned image digests in `deploy/docker-compose.yml`, then `make deploy`. Convex schema validation prevents incompatible schema changes from deploying without a migration.

---

## Running tests

```bash
pnpm install
pnpm test:convex                             # 52 backend unit + conformance tests
cd apps/web && pnpm exec playwright test    # 11 end-to-end tests (requires live stack + mailpit)
```

The end-to-end suite exercises the full handoff flow across two accounts, real SMTP delivery to a mailpit catcher, branch operations, and the §24 acceptance scenarios.

---

## Repository layout

```
/convex            Backend — schema, auth, and all domain modules
/apps/web          Frontend — TanStack Start (React, SSR)
/packages/shared   Shared Zod schemas and constants (single source for limits)
/deploy            Docker Compose, Caddyfile, Makefile, .env.example
/docs              Operations guides and agent knowledge base
```

For a full codebase map, see [`agents.md`](./agents.md).

---

## LXC hosting

LXC is fully supported. The simplest path is Docker nested inside a privileged LXC container (Proxmox-style) — the stack runs identically to a bare Docker host. For native-process LXC, see [`docs/lxc.md`](./docs/lxc.md).

---

## Contributing

Pull requests are welcome. The spec is [`spec.md`](./spec.md) — new features should align with the design goals there. The permanent non-goals (multi-tenancy, due dates, in-app messaging, public catalog browsing) are intentional and will not be reconsidered.

Before opening a PR:

```bash
pnpm typecheck
pnpm test:convex
pnpm lint
```

---

## License

MIT

---

*Stwrd is free software. Your organization owns its installation, its records, and its data completely. There are no accounts to create elsewhere, no services to subscribe to, and no one to answer to but each other.*
