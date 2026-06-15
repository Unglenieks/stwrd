# 0011 — Home page redesign

**Phase:** post-5 · **Status:** ✅ Done

> Improve the signed-in home page from a bare welcome card into a proper
> landing page; relocate two controls to their natural homes.

## What changed

### `/` — landing page (`apps/web/src/routes/index.tsx`)

Replaced the minimal welcome card with a full landing page:

- **Hero section** — dark gradient (`slate-900 → slate-700`) with a subtle grid
  overlay, org name (`instanceSettings.orgName`), personalised greeting, and two
  CTA buttons ("Browse catalog" → `/items`, "Contribute an item" → `/contribute`).
- **Available-for-checkout grid** — `usePaginatedQuery(api.items.list, { state:
  "available" }, { initialNumItems: 8 })` feeds a 2→4-column responsive card
  grid. Each card: square photo with a hover scale, green "Available" pill,
  item name, 5-dot condition indicator. Includes skeleton loading placeholders
  (animated pulse, 8 cards) and an empty state with a contribute link.

### Email notification preference → `/me` (`apps/web/src/routes/me.index.tsx`)

Removed the bare checkbox from `/` and added a `NotificationPref` settings card
at the top of the My Library page. The control is now a proper toggle switch
(`role="switch"`, `aria-checked`) with a label and a one-line description.
Calls `api.users.updateProfile({ notificationPref })` on click — same mutation
as before.

### Invite form — home screen copy removed

The `InviteMember` component that duplicated the invite form on the home screen
is removed. The canonical `InviteForm` in `/admin/members` already provides the
full invite flow (error handling, email-queued confirmation, copy-link fallback)
and is the correct place for that action.

## Verification

- `tsc --noEmit` on `apps/web` passes clean.
- Dev server (`pnpm --filter web dev`) served the page at `http://localhost:3000`
  against the live local Convex backend; layout, item grid, and toggle confirmed
  working in-browser.
