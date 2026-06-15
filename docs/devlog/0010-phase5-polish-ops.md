# 0010 — Phase 5: Polish & ops

**Phase:** 5 (§21) · **Status:** ✅ Done — **project complete**
**Commit:** (this change)

> Phase 5: admin audit feed, delivery log, backup/restore tooling + CI restore
> drill, Playwright conformance suite implementing §24 scenarios, docs (ops
> README, LXC guide, domain-change runbook).

## Admin audit + delivery log UI (§15)
- `/admin/audit` — the cross-item **audit feed** (role changes, admin transfers,
  cancellations, settings edits…), the **email delivery log** (state + attempts +
  last error), and the **unmatched inbound** list. Gated by `instance.audit_view`;
  linked from the home admin row. (Backend queries `admin.auditFeed` /
  `admin.emailLog` / `admin.unmatchedInbound` shipped in Phase 4.)

## Conformance suite (§24)
- `convex/conformance.test.ts` — the backend-expressible scenarios with stable
  `C-##` IDs: **C-02** (invite dup/TTL), **C-03** (OTP lockout), **C-05** (recovery
  codes), **C-16** (last-admin guard), **C-20** (ledger seq integrity).
- `docs/conformance.md` — the full **C-01…C-21 → test** map (convex-test for
  invariants, Playwright for UI flows), with honest notes on the two
  observation/ops-verified scenarios (C-04, C-21) and the IMAP socket layer.

## Backup / restore + CI (§18.4, §18.1)
- `deploy/restore-drill.sh` — export → `import --replace` → verify the instance
  still reads as set up. **Run locally against the live backend: exported 589
  documents, restored, verified ✅.**
- `.github/workflows/ci.yml` — a fast `test` job (typecheck + shared/convex unit
  tests + frontend build; convex-test needs no backend) and a `restore-drill` job
  that boots the pinned Convex backend as a service, deploys, seeds via
  `setup:wizard`, and runs the drill. Weekly `pnpm audit` schedule.

## Docs
- `docs/ops-README.md` (first-run §19.2, email, backup/restore, observability,
  upgrades), `docs/domain-change.md` (§19.5 origin variables + runbook),
  `docs/lxc.md` (§3.3, both hosting paths).

## Verification
- `pnpm test:convex` → **52/52** (5 new conformance tests). Shared **6/6**.
  Playwright **11/11**. All packages typecheck; frontend build clean.
- Restore drill verified locally end-to-end.

## Deviations / deferred (documented)
- **`/healthz`**: this TanStack Start version didn't accept the custom server-route
  form we tried; the frontend health probe is `/` (200 when up). Tracked in
  `ops-README.md`.
- **Live-IMAP e2e**: the ingest/classification logic is unit-tested; a greenmail
  IMAP round-trip is a future hardening item.
- **C-04 / C-21**: verified by observation + the documented ops runbook rather than
  a dedicated automated assertion (see `docs/conformance.md`).

## Project status
All five spec phases (§21) are implemented and tested: foundation/auth →
circulation core → stewardship → branches & inbound email → polish & ops. A
community org can self-host the stack, bootstrap, invite members, and run a
Stwrd's custody-based sharing workflow end to end.
