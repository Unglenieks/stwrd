# 0003 — Phase 2 · Step 1: Taxonomy (categories + tags)

**Phase:** 2 (§21) · **Step:** 1 of 5 · **Status:** ✅ Done
**Commit:** (this change)

> Phase 2 plan (5 steps): **1. Taxonomy** → 2. Media pipeline + contribution →
> 3. Catalog & item page → 4. Claim & handoff → 5. Expiry cron & polish.
> End of phase 2 = a usable library.

The taxonomy substrate that contribution depends on (items reference a category;
items carry tags), plus a curation surface for admins.

## What was built

### `convex/categories.ts` (§7.7, §22.2 categories.*)

- `tree` (query, session) — the category tree for pickers and the admin editor;
  `includeArchived` toggles archived nodes (omitted from pickers).
- `upsert` (mutation, `categories.manage`) — create/edit a node. Enforces **depth
  ≤ 3** (computed from the parent chain), validates the parent exists, rejects
  **re-parenting under one's own descendant** (cycle), and rejects moves whose
  subtree height would overflow the depth limit.
- `archive` (mutation, `categories.manage`) — archive/unarchive; **never blocks**
  (§22.4): items keep their reference, the node just leaves pickers.

### `convex/tags.ts` (§7.7, §15, §22.2 tags.*)

- `list` (query, `categories.manage`) — every tag with usage counts for the admin
  tag manager.
- `rename` / `merge` (mutations, `categories.manage`) — batch rewrite `from → to`
  across all items, de-duplicating and clamping to the per-item tag limit. Input
  is normalized (trim + lowercase, §7.7) on the way in. Rename and merge share one
  rewrite primitive — the distinction is intent (fresh name vs. fold into an
  existing one), audited separately.

### Backend test harness (seeds Phase 5 §24 conformance suite)

- Added **convex-test** + an edge-runtime Vitest config (`vitest.convex.config.ts`,
  `pnpm test:convex`) that runs Convex functions in-process against an in-memory
  DB — no Docker backend needed, CI-friendly.
- `convex/test.helpers.ts` — `seedUser(permissions)`, `asUser` (binds a Convex
  Auth identity as `userId|session`), `seedItem`.
- `convex/taxonomy.test.ts` — **7 tests**: depth cap, permission gating, cycle
  rejection, archive-never-blocks (+ item keeps ref), tag rename rewrite, merge
  de-dup, tag normalization.

## Verification

- `pnpm test:convex` → **7/7 pass**.
- `tsc -p convex/tsconfig.json` clean; deploys to the live backend (schema valid).
- Convex tsconfig now excludes `**/*.test.ts` (Convex already excludes them from
  the deployed bundle; this keeps the deploy typecheck off Vite-only
  `import.meta.glob`).

## Notes

- No default categories are seeded; the org's admins create the tree (Step 2's
  `/contribute` form will require an existing category, and the admin categories
  editor UI lands with the broader admin UI).
- `tags.list` aggregates over all items — fine at v1 scale (hundreds–low
  thousands, §18.3); revisit if an org outgrows it.

## Next (Step 2)

Media pipeline (storage upload URL + server-side EXIF/GPS verification, §18.1) +
`items.contribute` with the genesis ledger entry and the atomic-seq ledger
helper, plus the `/contribute` form.
