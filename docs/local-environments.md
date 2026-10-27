# Local environments and agent builds

How to get a running, testable Stwrd build without paid cloud services. Written for
agents and for Daniel, who hosts the project on his own fleet (Forgejo, Oceanus
Proxmox, Shipyard agent VM).

## What this project uses today

Stwrd is self-hosted by design. Each organization runs it from `deploy/` on its own
Docker host. There is no hosted production instance and no deployment from this repo.

| Environment / workflow | Where it runs | Cloud cost or dependency |
| --- | --- | --- |
| Production | None. Each organization runs its own instance from `deploy/docker-compose.yml`. | None. No Railway, Vercel or Convex Cloud project exists (`railway list` shows none for Stwrd; `convex.json` has no cloud deployment). |
| Staging / preview environments | None | None |
| CI | Forgejo Actions on the fleet runner (`.forgejo/workflows/`) | None. GitHub Actions is no longer used. |
| Backend for development | Self-hosted Convex in Docker (`deploy/`) | None at runtime |
| Unit + conformance tests | `pnpm test:convex` (convex-test, in-process) | None. No backend needed. |
| End-to-end tests | Playwright against a local stack plus a mailpit container | None |
| Email | The org's own SMTP/IMAP mailbox, configured in the app | None (mailpit in tests) |

External things a build still downloads (free, public, no accounts): container images
from `ghcr.io/convex/*` and Docker Hub (`caddy`, `ubuntu`), npm packages, and the
NodeSource apt repo during the bootstrap image build. Images are pinned by digest, so a
registry move breaks pulls rather than silently changing the image (this happened when
upstream moved from `ghcr.io/get-convex/` to `ghcr.io/convex/`).

**Nothing stays on paid cloud** because nothing is on it now.

## Getting a testable build

### 1. Without Docker (Shipyard, any machine with Node 22 and pnpm)

```sh
pnpm install
pnpm typecheck
pnpm test:convex          # 52 backend unit + conformance tests, no backend needed
pnpm -F @stwrd/web build
```

This covers most backend changes: convex-test runs the real functions in-process.

### 2. Full stack through CI (no Docker on the agent's machine)

The **Quickstart smoke** workflow ([`.forgejo/workflows/quickstart.yml`](../.forgejo/workflows/quickstart.yml))
builds the images, starts the quickstart stack on the fleet CI runner, waits for the
bootstrap, and checks the frontend, `/api/version`, JWKS and a password login through
the Caddy proxy. It then removes everything. It runs on pull requests that touch the
stack and can be started by hand:

```sh
fleet-ci dispatch stwrd quickstart.yml <branch>
fleet-ci wait stwrd && fleet-ci logs stwrd <run>
```

The same check runs anywhere with Docker: `deploy/quickstart-smoke.sh` (set `KEEP=1`
to leave the stack up). The `restore-drill` job in `ci.yml` covers deploy, seed and
backup/restore against a real backend.

The stack is torn down after each run, so this answers "does it build and start", not
"let me click around".

### 3. A running stack to use (any Docker host)

```sh
cd deploy
docker compose -f docker-compose.quickstart.yml --env-file .env.quickstart up -d
cat secrets/server-manager-credentials.txt   # after ~60 s
```

Open http://localhost. The quickstart stack is HTTP only and hard-codes
`http://localhost` as its origin, so it is only usable from the host itself or through
an SSH tunnel (`ssh -L 8080:127.0.0.1:80 <host>`). For Playwright, also start mailpit on
the stack network (see [`conformance.md`](./conformance.md)).

## Recommendation: shared agent-build Docker host with per-branch URLs

For Stwrd alone, options 1 and 2 are enough for most agent work. A running, clickable
build per branch is useful for UI work and for Daniel to review a PR. It needs fleet
infrastructure that other projects need too, so it should be one shared service rather
than something Stwrd-specific.

**Infrastructure (to be provided by the fleet; not created by this repo):**

1. **An "agent builds" Docker VM on Oceanus**, separate from the CI runner (which is
   stateless and shared). Roughly 4 vCPU, 8 GiB RAM, 64 GiB disk is enough for several
   Stwrd stacks (each runs a Convex backend, a Node frontend and Caddy; footprint not yet measured).
   Shipyard agents need SSH (or a Docker context) to it.
2. **A wildcard DNS name and certificate**, for example `*.preview.home.unglenieks.com`,
   pointing at Nginx Proxy Manager. NPM forwards the wildcard host to one reverse proxy
   on the VM (Caddy or Traefik) that routes by `Host` header to each stack. LAN and
   tailnet only, like other home services.
3. Optionally, a self-hosted PaaS (Dokploy or Coolify) on that VM instead of the
   hand-rolled router. Both deploy a compose file per branch from a Forgejo webhook and
   assign a hostname. Worth it if several projects want previews; for Stwrd alone a
   script is simpler.

**Per-branch stack for Stwrd:**

- Compose project `stwrd-<branch-slug>`, built from `deploy/docker-compose.quickstart.yml`
  (it includes the bootstrap service) plus an override that replaces the
  `http://localhost` origins, drops the host ports (as `quickstart-smoke.sh` does) and
  attaches the proxy to the router network.
- `SITE_ORIGIN=https://stwrd-<branch-slug>.preview.home.unglenieks.com`,
  `CONVEX_CLOUD_ORIGIN=$SITE_ORIGIN/api`. The frontend reads its origin at start-up
  (`apps/web/docker-entrypoint.sh`), so the same image works under any hostname.
- A fresh `INSTANCE_NAME`/`INSTANCE_SECRET` per stack, generated on the VM and never
  committed. The bootstrap writes the server-manager credentials to the VM's
  `deploy/secrets/`, where only fleet agents and Daniel can read them.
- Created by a `workflow_dispatch` job or a script an agent runs over SSH; removed with
  `docker compose -p stwrd-<slug> down -v` when the PR closes. Stacks hold only test data.

Repo work still needed when the host exists: a `docker-compose.preview.yml` override
(no host ports, external router network) and a small `deploy/preview.sh up|down <branch>`
script. These are not added yet because the host and naming are fleet decisions.
