# 0002 — Phase 1: Frontend (auth surfaces)

**Phase:** 1 (§21) · **Status:** ✅ Done
**Commit:** (this change)

The TanStack Start frontend (`apps/web`) bringing the Phase 1 auth surfaces
online: bootstrap wizard, login with second factor, and invite acceptance —
verified end-to-end in a real browser against the live Convex backend.

## What was built

### App scaffold (spec §4)

- **TanStack Start 1.168** (React 18, SSR) on Vite 7; file-based routes; the
  router entry exports `getRouter` (the framework's expected name).
- Tailwind CSS + minimal **shadcn/ui-compatible** primitives (`Button`, `Input`,
  `Label`, `Card`, `cn`) — full shadcn component generation arrives with the
  Phase 2 member UI; these match its API so they swap cleanly.
- The Convex generated API is imported via the `@cvx/*` path alias
  (`../../convex/_generated`); Vite `fs.allow` opened to the repo root.

### Runtime config (§19.5)

`/runtime-config.json` is fetched before the Convex connection opens — no
hostname baked at build time. `ConvexClientProvider` loads it, constructs the
`ConvexReactClient`, and mounts `ConvexAuthProvider` (client-side only; during
SSR and the brief fetch it shows a splash). `useSiteUrl()` exposes the Convex
HTTP-actions origin for the custom `/auth/*` calls.

### Auth routes

- `/setup` — the §6.3 wizard (org name, server-manager account, 2FA policy);
  redirects to `/login` once `setupStatus.setupComplete` (C-01).
- `/login` — password phase → `/auth/login`; on `complete`, exchanges the
  completion token via Convex Auth `signIn("credentials", …)`; on `mfa_required`,
  renders the second-factor step (TOTP / email OTP / recovery code) → `/auth/mfa/*`.
  Navigation is driven reactively off `isAuthenticated` (see gotcha below).
- `/invite/$token` — sets a password → `/auth/invite/accept` → session.
- `/` — redirects to `/setup` (fresh instance) or `/login` (signed out); shows a
  minimal signed-in home with sign-out otherwise.
- `lib/authApi.ts` — typed client for the `/auth/*` HTTP actions, mapping the
  closed error codes (§22.5) to copy.

### Deploy artifacts

- `apps/web/Dockerfile` (multi-stage; build context = repo root for the
  workspace) + `docker-entrypoint.sh` that writes `/runtime-config.json` from
  `PUBLIC_API_ORIGIN` / `PUBLIC_CONVEX_SITE_ORIGIN` at start (§19.5).
- Compose frontend env + healthcheck updated.

## Verification

Playwright smoke suite (`apps/web/tests/auth.smoke.spec.ts`, Chromium) — **4/4
pass** against the live backend:

1. signed-out `/` → redirects to `/login`
2. `/setup` closed after bootstrap (C-01)
3. password sign-in → session established → signed-in home
4. wrong password → error, stays on `/login`

(This also seeds the Phase 5 Playwright harness.) Frontend `tsc` clean; client +
SSR production build succeeds.

## Gotchas resolved

- **`getRouter` (not `createRouter`)** is the router-entry export the Start
  client expects.
- **`CONVEX_SITE_ORIGIN` must be the backend HTTP-actions origin (:3211), not
  the frontend URL.** Convex Auth derives the JWT issuer + JWKS URI from it; the
  backend resolves its own provider there. Pointing it at the frontend made
  provider discovery fail (`No auth provider found matching the given token`) so
  `isAuthenticated` never flipped despite valid stored tokens. Requires a backend
  restart **and** `convex deploy` (the issuer domain is baked into the deployed
  `auth.config.ts`). Modeled as a distinct env var; browser-facing counterpart is
  `PUBLIC_CONVEX_SITE_ORIGIN`.
- **Navigate on `isAuthenticated`, not imperatively after `signIn`** — `signIn`
  stores tokens a tick before the Convex client reports authenticated, so an
  immediate `navigate("/")` bounced back to `/login`.
- The per-account login limit (10/15 min) trips under repeated local test runs;
  clear `rateLimits` via `convex import --replace`.

## Deferred (Phase 2 member UI)

- Full shadcn component generation; the `/me/settings` screen with interactive
  TOTP enrollment (the backend `twofactor.*` actions are ready and unit-exercised).
- A dedicated `/healthz` server route (compose currently health-checks `/`).
