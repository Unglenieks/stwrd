# 0009 — Phase 4: Branches & inbound email

**Phase:** 4 (§21) · **Status:** ✅ Done
**Commit:** (this change)

> Phase 4: branch CRUD/pages, branch handoff modes, IMAP poll, admin queues
> (stuck handoffs, unmatched mail, recovery).

## Backend

### Branches (§12)
- `branches.create` / `update` / `list` / `get`. Deactivation is blocked while any
  item is flagged to the branch (`branch_has_items`, §22.4). `branchesEnabled`
  gate. Access notes shown to members (physical access is public anyway).

### Branch + staging handoff (§12)
- `markAvailable(branch, branchId)` flags the item to the branch (`atBranchId`).
- A branch claim carries the branch; `confirmGiver` writes `placed_at_branch`
  ("dropped off"), and finalize writes `removed_from_branch` + clears the flag on
  pickup (**C-12**).
- `claims.createStaging` — park an unclaimed item with the branch **host** (a real
  custody transfer run through the claim machinery); finalize leaves it IN_CUSTODY
  under the host with `placed_at_branch` (**C-13**).

### Admin (§9.3, §15, §6.4)
- `claims.adminResolve` — force-complete records an **`admin_transfer`** (never a
  synthetic `handoff_completed`, **C-11**); force-cancel returns the item to
  AVAILABLE (reason `admin`).
- `users.adminTransfer` (needs `items.edit_any` **and** `claims.manage_any`);
  deactivation now auto-cancels the member's pending claims (**C-17**).
- `admin.stuckClaims` / `liveClaims` / `recoveryQueue` / `unmatchedInbound` /
  `emailLog` / `auditFeed` — each gated by its panel's permission.

### Inbound email / IMAP (§13)
- `inbound.ingestInbound` (testable internal mutation): classifies each message as
  **bounce** (DSN), **logged** (reply matched to a claim via the `[LOT#id]`
  subject token or `+claim-<id>` plus-address → appended to the claim record +
  both parties notified), or **unmatched**; UID-deduped; never changes state.
- `imapPoll.pollInbound` (Node action, ImapFlow): connect → fetch unseen →
  ingest → mark seen → disconnect. Cron every 2 min. No-op when IMAP unconfigured.

## Frontend
- `/branches` (list + register form) and `/branches/:id` (items here, host
  contact/access, host deactivate).
- Holder controls gained branch options: **List at branch** and **Stage at branch**.
- `/admin/claims`: stuck-handoffs queue (force-complete / force-cancel) and the
  custodian-inactive recovery queue ("recover to me"). Home shows Admin links by
  permission.

## Verification
- `pnpm test:convex` → **47/47** (9 new: branch deactivate guard, C-12 branch drop,
  C-13 staging, C-11 admin force-complete = admin_transfer, force-cancel, C-17
  deactivation cancels claims + recovery queue, adminTransfer, inbound
  reply-capture / bounce / unmatched / UID-dedupe).
- Playwright → **11/11** (added a branches e2e: register → list item at branch →
  branch page shows it). All packages typecheck; build succeeds.

## Notes / deferred
- IMAP socket layer is exercised via the testable `ingestInbound` (the actual
  classification logic); a live IMAP server e2e (e.g. greenmail) is a nice-to-have
  deferred to the Phase 5 conformance work — the matching is fully unit-tested.
- The `[LOT#id]` token regex was widened to `[^\]\s]+` (Convex ids aren't pure
  `[a-z0-9]`).
- Bounce → outbox-row correlation ("member email may be broken") currently
  surfaces the bounce in the unmatched/inbound admin view; tighter linking to the
  specific failed `emailOutbox` row is a Phase 5 polish item.

Phases 1–4 complete. **Phase 5** (admin audit feed UI, delivery log UI,
backup/restore + CI restore drill, the full §24 Playwright conformance suite,
ops docs) is next.
