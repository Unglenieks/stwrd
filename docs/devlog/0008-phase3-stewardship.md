# 0008 — Phase 3: Stewardship

**Phase:** 3 (§21) · **Status:** ✅ Done
**Commit:** (this change)

> Phase 3: repair workflow, retirement workflow, status updates, watching,
> notifications + SMTP outbox.

## Backend

### Repair (§10)
- `items.repairStart` / `items.repairComplete` (actions → internal mutations;
  photo-verified). UNDER_REPAIR → IN_CUSTODY, raising the condition;
  `repair_started` / `repair_completed` ledger entries.

### Retirement (§11)
- `items.proposeRetirement` (action; ≥1 photo; no live claim) → `retirement_proposed`.
- `retirements.decide` — `items.retire_approve`; **proposer ≠ decider unless
  they're the org's sole approver** (audited); blocked during a live claim
  (`state_conflict`); approve → RETIRED + `retired`, deny → `retirement_denied`;
  notifies the proposer. `items.get` exposes `retirementProposed` for the
  approver card.

### Watching (§9.5)
- `watches.toggle`. `notifyWatchers(item, except)` fires `watched_item_available`
  to every watcher except the actor, wired into every →AVAILABLE transition
  (markAvailable, claim cancel, expiry sweep). Watching confers no priority.

### Notifications inbox (§14)
- `notifications.list` (paginated, newest-first via a new `by_user` index),
  `unreadCount`, `markRead`, `markAllRead`.

### Email outbox / SMTP (§13)
- `notify()` now mirrors to email when the recipient's `notificationPref` is
  `email` and the kind has a template — enqueued into `emailOutbox` (the delivery
  log), in-app always sent.
- `lib/emailTemplates.ts`: the §23.4 templates (normative subjects, plain-text
  bodies, URLs from `siteUrl`, `[LOT#id]` token).
- `emailDrain.ts` (**Node runtime**): `drainOutbox` cron action (every 1 min) —
  Nodemailer over the org SMTP (password decrypted with `APP_SECRETS_KEY`),
  retry/backoff (3 attempts, 1m/10m/60m), marks sent/failed. `testSmtp` action.
- The invite email now carries the actual invite URL (was missing).

## Frontend
- Item page: **Watch** toggle; **holder controls** (status update, mark-available
  / withdraw, repair completion, retirement proposal); **approver card**.
- `/notifications` inbox + a 🔔 bell with unread badge on the home; per-account
  "also email me" preference toggle.
- `/admin/settings`: SMTP config form + "send test email" + "remove email config".

## Verification

- `pnpm test:convex` → **38/38** (8 new stewardship tests: repair state machine,
  retirement approve / sole-approver / not-sole-approver-forbidden / blocked-by-
  live-claim, watcher-notify-except-actor, watch toggle, inbox unread/markRead,
  email-pref enqueues an outbox row).
- Playwright → **10/10**, including:
  - a **real SMTP delivery** test (configure SMTP via the admin UI → send test →
    a **mailpit** catcher on the backend's docker network receives it), and
  - a stewardship e2e (watch → withdraw → propose retirement w/ photo → approve →
    RETIRED + ledger).
- The **outbox drain** verified out-of-band: an enqueued OTP row drained through
  Nodemailer to mailpit with the correct rendered subject and a recorded
  `messageId`.

## Notes & decisions

- **Configuring SMTP correctly forces the full-permission admin into 2FA**
  (§6.2 — "the keys to the instance never ride on a single password"). This is
  right, but it means the password-login test fixtures must run with SMTP off, so
  the email test now removes the config when done, and the Playwright suite runs
  single-worker (shared live backend + global-state mutation). Added a "Remove
  email config" affordance to settings (a real feature) to support this.
- The email test depends on a **mailpit** container on the `deploy_default`
  network: `docker run -d --name mailpit --network deploy_default -p 8025:8025
  axllent/mailpit`.

## Deferred (later phases)
Branches, IMAP inbound (bounce + reply capture), admin queues (Phase 4); the
full admin dashboard, audit feed, backup/restore, and the §24 conformance suite
(Phase 5).
