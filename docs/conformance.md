# §24 conformance map

Stwrd's acceptance suite (`spec.md` §24, scenarios **C-01…C-21**) mapped 1:1 to
the tests that encode them. Backend invariants are covered by **convex-test**
(in-process, deterministic, no backend needed); UI-observable flows by
**Playwright** end-to-end tests driving the real app against the live stack. Test
titles carry the `C-##` IDs.

Run: `pnpm test:convex` (backend) and `cd apps/web && pnpm exec playwright test`
(e2e — needs the local stack + a mailpit catcher for the email test).

| ID | Scenario | Where |
|---|---|---|
| C-01 | Bootstrap → routes redirect to `/setup`; wizard creates manager + settings; `/setup` then closes | `apps/web/tests/auth.smoke.spec.ts` |
| C-02 | Invite: dup email → `validation_failed`; past-TTL → `not_found` | `convex/conformance.test.ts`; accept path: `handoff.smoke.spec.ts` |
| C-03 | Login (required): password → OTP; wrong OTP ×5 → lockout | `convex/conformance.test.ts`; password login: `auth.smoke.spec.ts` |
| C-04 | Policy `off`: ordinary member password-only; full-permission account still second-factored | Observed in `email.smoke.spec.ts` (enabling SMTP forces the admin into 2FA); decision logic in `convex/http.ts` |
| C-05 | Recovery code single-use; regeneration voids the old set | `convex/conformance.test.ts` |
| C-06 | Claim happy path → custody moves; receiver blocked until photo | `convex/claims.test.ts`; e2e `handoff.smoke.spec.ts` |
| C-07 | Claim race → exactly one winner | `convex/claims.test.ts` |
| C-08 | `confirmReceiver` without photo → `photo_required`; no zero-photo `handoff_completed` | `convex/claims.test.ts` |
| C-09 | Expiry sweep cancels + warns once | `convex/expiry.test.ts` |
| C-10 | Expiry pause: half-confirmed claim skipped, surfaces in stuck queue | `convex/expiry.test.ts`; admin queue `convex/admin.ts` |
| C-11 | Admin force-complete = `admin_transfer` (not `handoff_completed`); force-cancel | `convex/phase4.test.ts` |
| C-12 | Branch drop: `placed_at_branch` → `removed_from_branch` | `convex/phase4.test.ts`; e2e `branches.smoke.spec.ts` |
| C-13 | Staging → host accepts → IN_CUSTODY under host + `placed_at_branch` | `convex/phase4.test.ts` |
| C-14 | Repair cycle raises condition → IN_CUSTODY; `seq` strictly +1 | `convex/stewardship.test.ts` + `convex/conformance.test.ts` (C-20) |
| C-15 | Retirement propose → approve → RETIRED; live-claim block; self-approval rule | `convex/stewardship.test.ts` |
| C-16 | Last-admin guard → `last_admin_protected` | `convex/conformance.test.ts` |
| C-17 | Deactivation cancels pending claims; held items → recovery queue | `convex/phase4.test.ts` |
| C-18 | Watch → all watchers notified except the actor; no priority | `convex/stewardship.test.ts` |
| C-19 | EXIF/GPS upload rejected server-side → `validation_failed` | `convex/items.test.ts` |
| C-20 | Ledger immutability — no gaps/dupes in `seq` (insert-only via `lib/ledger`) | `convex/conformance.test.ts` |
| C-21 | Domain change: edit origins + restart → working app + emails, no rebuild | Ops runbook `docs/domain-change.md` (runtime-config mechanism, `apps/web/docker-entrypoint.sh`) |

## Honest coverage notes

- **C-04** and **C-21** are verified by observation / ops procedure rather than a
  dedicated automated assertion: C-04's full-permission-forces-2FA behavior was
  seen live while wiring the SMTP test (enabling email immediately required the
  admin to second-factor), and C-21 is the runtime-config domain-change mechanism
  exercised by the entrypoint + documented runbook. Everything else has a
  dedicated, passing test.
- The **IMAP socket layer** (ImapFlow connect/fetch) is covered through the
  `inbound.ingestInbound` classification logic (bounce / reply / unmatched /
  UID-dedupe) in `convex/phase4.test.ts`; a live-IMAP server e2e is a future
  hardening item.
