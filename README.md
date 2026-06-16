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

- Docker and Docker Compose v2
- Git (to clone the repo — the bootstrap container bundles the Convex CLI)

For production: a domain name and ports 80/443 open for automatic TLS.

---

## Quickstart (localhost)

Try Stwrd on your laptop with no domain or TLS configuration:

```bash
git clone https://github.com/Unglenieks/stwrd.git
cd stwrd/deploy
docker compose -f docker-compose.quickstart.yml --env-file .env.quickstart up -d
```

Wait about 60 seconds for the bootstrap to complete, then:

```bash
cat secrets/server-manager-credentials.txt
# or: docker compose -f docker-compose.quickstart.yml logs bootstrap
```

Open **http://localhost** and log in with the credentials shown.

To stop: `docker compose -f docker-compose.quickstart.yml down`
To wipe data and start fresh: add `-v` to the down command.

---

## Production deployment

### 1. Clone and enter the deploy directory

```bash
git clone https://github.com/Unglenieks/stwrd.git
cd stwrd/deploy
```

### 2. Generate your environment file

```bash
make setup-env SITE_ORIGIN=https://library.example.org
```

This writes a `.env` with random `INSTANCE_NAME` / `INSTANCE_SECRET` values and URLs
derived from your domain. Then open `.env` and set:

- `ACME_EMAIL` — a real address for Let's Encrypt certificate notifications
- `ORG_NAME` — your organisation's name (e.g. `Riverside Tool Library`)
- Optionally `SERVER_MANAGER_EMAIL` — defaults to `admin@<yourdomain>`

Leave `SERVER_MANAGER_PASSWORD` blank; a strong random password will be generated and
printed to the bootstrap logs.

### 3. Start the stack

```bash
docker compose up -d
```

This builds the frontend image, starts the backend, dashboard, and proxy, and runs the
bootstrap container once. The bootstrap deploys the Convex functions, generates all
secrets, and creates the server-manager account automatically.

Wait for bootstrap to finish (~60–90 seconds on first run):

```bash
docker compose logs bootstrap
# or: make bootstrap-logs
```

### 4. Log in

```bash
cat secrets/server-manager-credentials.txt
```

Open your domain and log in with the credentials shown. The file also contains the admin
key — store it somewhere safe before closing the terminal.

### 5. Follow the first-run checklist

See [`docs/first-run.md`](./docs/first-run.md) for the post-install steps:
reset your generated password, configure email, enable two-factor authentication,
and invite your first members.

---

## Operations

### Backups

```bash
cd deploy && make backup
```

Exports a consistent snapshot of all data and file storage to `backups/`. Schedule nightly
with cron. To restore from a snapshot:

```bash
make restore SNAPSHOT=backups/snapshot-<date>.zip
```

### Domain changes

Edit `SITE_ORIGIN` and `CONVEX_CLOUD_ORIGIN` in `deploy/.env`, then restart:

```bash
docker compose up -d
```

No rebuild needed. Full runbook: [`docs/domain-change.md`](./docs/domain-change.md).

### Upgrades

Bump the pinned image digests in `deploy/docker-compose.yml`, then:

```bash
docker compose up -d
```

The bootstrap container re-runs on each `up -d` but exits immediately if the instance is
already provisioned. Convex schema validation prevents incompatible changes from deploying
without a migration.

---

## Running tests

```bash
pnpm install
pnpm test:convex                             # 52 backend unit + conformance tests
cd apps/web && pnpm exec playwright test     # 11 end-to-end tests (requires live stack + mailpit)
```

---

## Repository layout

```text
/convex            Backend — schema, auth, and all domain modules
/apps/web          Frontend — TanStack Start (React, SSR)
/packages/shared   Shared Zod schemas and constants
/deploy            Docker Compose, Caddyfile, Makefile, bootstrap
/docs              Operations guides and agent knowledge base
```

For a full codebase map, see [`agents.md`](./agents.md).

---

## LXC hosting

LXC is fully supported. The simplest path is Docker nested inside a privileged LXC
container (Proxmox-style) — the stack runs identically to a bare Docker host.
For native-process LXC, see [`docs/lxc.md`](./docs/lxc.md).

---

## Contributing

Pull requests are welcome. The spec is [`spec.md`](./spec.md) — new features should align
with the design goals there. The permanent non-goals (multi-tenancy, due dates, in-app
messaging, public catalog browsing) are intentional and will not be reconsidered.

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
