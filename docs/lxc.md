# LXC hosting guide (spec §3.3)

Docker Compose is the canonical reference deployment. LXC is fully supported — the
spec requires only that the three services run with the same **environment
contract** (§19.3). There are two mechanical paths.

## Option A — Docker nested inside an LXC container (Proxmox-style, common)

1. Create a privileged (or appropriately configured) LXC container and install
   Docker inside it.
2. Copy this repo + `deploy/.env`, then `docker compose up -d` exactly as on a
   Docker host. Nothing else differs.

This is the lowest-effort path and behaves identically to the reference stack.

## Option B — Native processes in LXC containers

Run the published artifacts directly, preserving ports, volumes, and env:

| Process | Provide | Env it needs |
|---|---|---|
| Convex backend | the published `convex-backend` binary/image | `INSTANCE_NAME`, `INSTANCE_SECRET`, `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, `POSTGRES_URL?` + the Convex deployment env (`APP_SECRETS_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`) |
| Frontend | Node 22 running `apps/web` (`pnpm build` → `node .output/server/index.mjs`) | `PUBLIC_API_ORIGIN`, `PUBLIC_CONVEX_SITE_ORIGIN` (entrypoint writes `runtime-config.json`) |
| Proxy | Caddy/Traefik | the public hostname (TLS) |

Plus **one persistent data directory** for the backend volume and **one ingress**.

## Conformance

Any runtime providing **these three processes + one persistent data directory +
one ingress**, wired with the environment contract above, is a conforming
deployment. The Compose file (§19.1) documents the canonical wiring; an LXC
translation is mechanical. See [`ops-README.md`](./ops-README.md) for first-run
steps and [`domain-change.md`](./domain-change.md) for the origin variables.
