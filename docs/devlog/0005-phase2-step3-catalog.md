# 0005 — Phase 2 · Step 3: Catalog & item page + ledger timeline

**Phase:** 2 (§21) · **Step:** 3 of 5 · **Status:** ✅ Done
**Commit:** (this change)

> Phase 2: 1. Taxonomy ✅ → 2. Media + contribution ✅ → **3. Catalog & item page**
> → 4. Claim & handoff → 5. Expiry cron & polish.

The browse/search surface and the item page whose ledger timeline is the
centerpiece (§16) — verified end-to-end in a browser.

## Backend (§17, §22.2)

- **Search substrate**: a Convex search index covers one field, so the items
  table gains a denormalized `searchText` (title + description + tags),
  maintained on every write that touches those inputs — `createContributed`,
  `items.update`, and `tags.rename`/`merge` (`lib/search.ts`). Added the
  `by_lastAvailableAt` index for the default browse sort.
- **`items.list`** (paginated) — full-text mode (search index + index-supported
  eq filters) or browse mode (`by_lastAvailableAt` desc with DB-level filters for
  state / category / branch / condition range). Filters the index can't express
  (condition range under search, tag-contains, RETIRED exclusion) are applied
  per page. Returns item cards with resolved photo URLs.
- **`items.get`** — full detail: custodian/category/branch names, watch + live-
  claim flags, `isMine`, primary photo URL. `not_found` when missing.
- **`items.ledger`** (paginated, newest-first, 50/page) — each entry resolved
  with actor/counterparty names and photo URLs.

## Frontend (§16)

- **`/items`** — card grid with search box, category filter, and a "needs repair"
  toggle (condition ≤ 2); `usePaginatedQuery` + "Load more"; excludes RETIRED by
  default. `StateBadge` component.
- **`/items/:id`** — photo, details/attributes, state badge, custodian, tags, and
  the **vertical ledger timeline** (actor, timestamp, note, condition delta,
  evidence photos). A disabled Claim affordance marks where Step 4 plugs in.
- Home links to Browse catalog + Contribute.

## Verification

- `pnpm test:convex` → **19/19** (5 new catalog tests: browse excludes RETIRED &
  sorts newest-available-first, includeRetired, condition + tag filters, get
  detail, ledger newest-first, get→not_found).
- Playwright (live backend) → **6/6**, incl. a new catalog e2e: contribute a
  uniquely-titled item → browse → search → open item page → see the `contributed`
  entry in the timeline.
- All packages typecheck; build succeeds.

## Notes

- `searchText` is **optional** in the schema (clean evolution): items created
  before this step appear in browse but not search until next saved — acceptable
  for the dev fixture; new items index immediately.
- Pages may be slightly shorter than the requested size when post-page filters
  (tags, condition-under-search) drop rows; the cursor still advances correctly.

## Next (Step 4)

The claim & two-party handoff protocol (`claims.create` / `confirmGiver` /
`confirmReceiver` / `cancel`) with the live driveway claim screen — the Claim
button on the item page goes live.
