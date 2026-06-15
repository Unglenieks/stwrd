# Hostname, TLS & domain-change runbook (spec §19.5)

The public hostname is a **single source of truth** in `deploy/.env`. There is no
second, independently editable base-URL field that could drift — every absolute
URL in outbound email (invite links, item links) derives from `PUBLIC_SITE_ORIGIN`,
and the admin Settings page shows it **read-only** so you can verify what the
instance believes about itself.

## The origin variables

| Var | What it is | Local example | Prod example |
|---|---|---|---|
| `PUBLIC_SITE_ORIGIN` | public frontend URL (email links, CORS) | `http://localhost:3000` | `https://library.example.org` |
| `PUBLIC_API_ORIGIN` | Convex client API origin | `http://127.0.0.1:3210` | `https://library.example.org/api` |
| `CONVEX_SITE_ORIGIN` | backend **HTTP-actions** origin — JWT issuer + JWKS + `/auth/*` (must reach the backend's :3211) | `http://127.0.0.1:3211` | `https://api.library.example.org` |
| `PUBLIC_CONVEX_SITE_ORIGIN` | browser-facing copy of the above (written to `runtime-config.json`) | `http://127.0.0.1:3211` | `https://api.library.example.org` |

> `CONVEX_SITE_ORIGIN` is **not** the frontend URL. Convex Auth derives the JWT
> issuer and the JWKS URL from it and the backend resolves its own provider there;
> pointing it at the frontend makes auth-provider discovery fail and logins never
> complete.

## No build-time baking

The frontend container entrypoint writes `/runtime-config.json` from the `PUBLIC_*`
env at startup; the client fetches it before opening the Convex connection
(`apps/web/docker-entrypoint.sh`). **A hostname change never requires an image
rebuild.**

## Runbook (a when-not-if event for DDNS hosts)

1. Edit the origin variables in `deploy/.env`.
2. `docker compose up -d` (recreates containers with the new env).
3. Caddy obtains/renews the certificate automatically (ACME HTTP-01; ports 80/443
   must be reachable). For CGNAT/dynamic-DNS, use the DNS-01 challenge with a Caddy
   DNS-provider plugin.
4. If `CONVEX_SITE_ORIGIN` changed, redeploy functions so the baked auth issuer
   matches: `npx convex deploy`.
5. Sessions are host-scoped cookies/tokens, so members simply log in again.
   Previously sent email links go stale (acceptable — invites can be resent).

## TLS

Caddy ([`deploy/Caddyfile`](../deploy/Caddyfile)) terminates TLS for the single
public hostname and routes `/api/*` → backend, everything else → frontend. The
dashboard (:6791) is intentionally not routed publicly.
