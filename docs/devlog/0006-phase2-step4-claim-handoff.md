# 0006 — Phase 2 · Step 4: Claim & two-party handoff protocol

**Phase:** 2 (§21) · **Step:** 4 of 5 · **Status:** ✅ Done
**Commit:** (this change)

> Phase 2: 1. Taxonomy ✅ → 2. Media + contribution ✅ → 3. Catalog & item page ✅
> → **4. Claim & handoff** → 5. Expiry cron & polish.

The heart of the system — instant claims and the live two-party driveway handoff,
where custody moves only when both humans confirm and the receiver attaches a
photo. Verified with a real two-account browser test.

## Backend (`convex/claims.ts`, §9, §22.2)

- **`claims.create`** — instant claim (`items.claim`); item AVAILABLE; claimant ≠
  custodian; atomic "no live claim" check (Convex serializes → C-07 race resolves
  to one winner, loser gets `item_not_available`). Flips item → CLAIMED, writes
  `claimed`, snapshots the exchange mode, reveals contact in `reveal_contact`
  mode, notifies the holder.
- **`claims.confirmGiver`** (mutation) / **`claims.confirmReceiver`** (action —
  photo verification needs blob I/O). Order-free; the second confirmation
  finalizes atomically: custody → receiver, state → IN_CUSTODY (or UNDER_REPAIR
  for repair claims), the receiver's condition becomes authoritative, and a
  `handoff_completed` entry embeds the receiver photo(s) + rating. The photo is
  required at every layer (action, internal mutation, and a finalize-time guard)
  so `handoff_completed` can never carry zero photos (C-08).
- **`claims.cancel`** — claimant / holder / `claims.manage_any`; writes
  `claim_cancelled` with the auto-derived reason; item → AVAILABLE; notifies the
  other party.
- **`claims.get`** — the live-screen query; party-only (or `claims.manage_any`),
  reveals the other party's contact in `reveal_contact` mode.
- `items.get` now returns `myActiveClaimId` (the live claim id, only when the
  viewer is a party) to drive the checklist. `lib/notify.ts` writes in-app
  notification rows (email/inbox UI come in Phase 3).

## Frontend (§9.2, §16)

- **`ClaimScreen`** — the live two-slot checklist for two phones in a driveway:
  reactive, contact card in `reveal_contact` mode, giver "I handed it off" slot,
  and the receiver photo + condition + "Confirm receipt" slot (button disabled
  until a photo is attached). Cancel link.
- **Item page** — real "Claim to borrow / to repair" buttons (instant, with the
  "just missed it" toast on a lost race); the checklist replaces them once the
  viewer is a party.
- **Invite a member** — a form for `users.create` holders wired to `users.invite`
  (the backend has existed since Phase 1 with no UI). Initially added to the home
  screen; relocated to `/admin/members` in 0011 where it lives beside the members
  table. This also enabled the two-account e2e.

## Verification

- `pnpm test:convex` → **26/26** (7 new claims tests: C-06 happy path with custody
  move, C-08 photo-required, C-07 race guard, self-claim forbidden, repair →
  UNDER_REPAIR, claimant cancel, stranger-cancel forbidden).
- Playwright → **7/7**, incl. a new **two-account handoff e2e**: admin contributes
  + invites → member accepts → claims → giver confirms → receiver confirms with a
  photo → custody moves (verified via "In care" + the `handoff_completed` timeline
  entry).

## Bug found & fixed (latent from Phase 1)

⚠️ **Invite acceptance never actually worked end-to-end.** `@convex-dev/auth`'s
account-linking (`shouldLinkViaEmail`) looks up the `users` table via an index
named **`email`**, but our schema override had named it `by_email`, so
`/auth/invite/accept` threw `Index users.email not found` — masked as a generic
401 by the auth error handler. Phase 1's tests only checked bad-token rejection,
so it slipped through. Renamed the index to `email` (updated the two usages); the
two-account e2e now exercises the real accept path. Also: `errorResponse` now
logs unexpected errors server-side (`console.error`) instead of swallowing them.

## Next (Step 5)

Claim expiry sweep + expiring notifier crons, the `/me` views, and final
lifecycle polish → end of phase = a usable library.
