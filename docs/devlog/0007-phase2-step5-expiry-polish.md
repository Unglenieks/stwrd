# 0007 — Phase 2 · Step 5: Expiry cron & lifecycle polish

**Phase:** 2 (§21) · **Step:** 5 of 5 · **Status:** ✅ Done — **Phase 2 complete**
**Commit:** (this change)

> Phase 2: 1. Taxonomy ✅ → 2. Media + contribution ✅ → 3. Catalog & item page ✅
> → 4. Claim & handoff ✅ → **5. Expiry cron & polish** ✅.
> End of phase = a usable library.

## Backend

### Expiry crons (§9.3, §23.2)

- **`claims.sweepExpired`** (every 15 min) — cancels claims past `expiresAt` that
  NO party has confirmed: `claim_cancelled` (reason `expired`), item → AVAILABLE,
  both parties notified (C-09). Claims with either confirmation are **skipped**
  (C-10) — they belong in the admin stuck-handoffs queue (Phase 4), not an
  auto-revert.
- **`claims.notifyExpiring`** (hourly) — one `claim_expiring` warning per claim
  within the 24 h window (tracked by a new `claims.expiringNotifiedAt` field).
- Both registered in `convex/crons.ts` (confirmed "Crons Added" on deploy).

### `/me` queries (§16, §22.2)

`me.custody` (items in my care), `me.claims` (my live checklists), `me.contributions`,
`me.watches` (reads the watches table; populated once watching ships in Phase 3).

## Frontend

- **`/me` "My library"** — active-claims list (with per-party confirmation
  status), "In my care" grid, "Contributed by me" grid. Linked from home.

## Verification

- `pnpm test:convex` → **30/30** (4 new: C-09 sweep, C-10 skip-half-confirmed,
  notifier-once-per-claim, me.* scoping).
- Playwright → **8/8** (added a `/me` e2e).
- All packages typecheck; build succeeds.

## Phase 2 acceptance (§24) — covered

| Scenario | Where |
|---|---|
| C-06 claim happy path → custody moves | claims.test + handoff e2e |
| C-07 claim race → one winner | claims.test (guard) |
| C-08 photo invariant on handoff | claims.test |
| C-09 expiry sweep + warning | expiry.test |
| C-10 expiry pause (skip half-confirmed) | expiry.test |
| C-14 repair cycle / seq +1 | items.test, claims.test |
| C-19 EXIF rejection | items.test |
| C-20 ledger immutability / seq | lib/ledger (insert-only) + tests |

(C-11 admin resolve, C-13 staging, C-15 retirement, C-18 watch are Phase 3/4 scope.)

## End-of-phase state: a usable library

A member can sign in, browse/search the catalog, contribute an item (camera →
EXIF-stripped upload), claim an available item, complete a two-party photo
handoff that moves custody, see it all on the item's immutable ledger timeline,
and manage everything from "My library" — with unclaimed claims expiring
automatically. Verified end-to-end with a real two-account browser test.

## Deferred to later phases (by design, §21)

Repair/retirement workflows, watching, the notifications inbox + SMTP outbox
drain (Phase 3); branches, IMAP, admin queues (Phase 4); admin audit feed,
backup/restore, the full §24 Playwright conformance suite (Phase 5).
