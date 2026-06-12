# 0004 — Phase 2 · Step 2: Media pipeline + contribution

**Phase:** 2 (§21) · **Step:** 2 of 5 · **Status:** ✅ Done
**Commit:** (this change)

> Phase 2: 1. Taxonomy ✅ → **2. Media + contribution** → 3. Catalog & item page →
> 4. Claim & handoff → 5. Expiry cron & polish.

Members can now add items: client-side image processing, server-side photo
verification, and the genesis ledger entry — verified end-to-end in a browser.

## Backend

### Media pipeline (§18.1, §18.2)

- `convex/storage.ts` — `generateUploadUrl` (one-time PUT target), `fileUrl` /
  `fileUrls` (authenticated URL serving only), and `verifyPhotos(ctx, ids)`: an
  action helper that fetches each blob and rejects non-images, > 5 MB, and
  anything still carrying EXIF/GPS/XMP (C-19).
- `convex/lib/exif.ts` — a conservative header scanner for the metadata markers
  of JPEG (APP1 Exif), WebP (EXIF/XMP chunks), and PNG (eXIf). A cleanly
  re-encoded image has none; no full decode (§18.1 "cheap check").

### Ledger writer (§7.4, §8.3)

- `convex/lib/ledger.ts` — `appendLedger(ctx, item, entry)`: the ONLY path that
  writes `ledgerEntries`. Reads `item.ledgerSeq`, inserts at `seq+1`, and bumps
  the item in the same transaction → per-item seq strictly +1, no gaps/dupes
  (C-14, C-20).

### Item functions (§8.2, §22.2, §22.3)

- `items.contribute` (**action**) → verifies photos, then `createContributed`
  (internal mutation) creates the AVAILABLE item + `contributed` genesis entry
  (≥1 photo, condition, custodian = contributor).
- `items.statusUpdate` (**action**) → verifies photos, then `applyStatusUpdate`.
- `items.update` (mutation) — metadata only; custodian + `items.update_own` or
  `items.edit_any`; never touches condition (§22.4); no ledger entry.
- `items.markAvailable` / `items.withdrawListing` (mutations) — state-guarded per
  the §22.3 matrix; both write the appropriate ledger entry.

## Frontend

- `apps/web/src/lib/imageUpload.ts` — `processImage` (canvas downscale to
  `photoMaxEdgePx`, re-encode to WebP which strips EXIF, quality search toward
  ~500 KB) + `uploadToConvex`.
- `apps/web/src/routes/contribute.tsx` — the §8.2 form (mobile-camera-first:
  `capture="environment"`): title, description, indented category picker (live
  `categories.tree`), tags, the 1–5 condition slider with the rubric label,
  exchange preference, multi-photo upload. Reachable from the signed-in home.
- Added a `Textarea` UI primitive.

## Deviation

- ⚠️ **`items.contribute` / `items.statusUpdate` are actions, not mutations
  (§22.2 labels them M).** Server-side EXIF verification (§18.1) needs blob I/O,
  which only actions can do, so each verifies then delegates to an internal
  mutation that performs the atomic item + ledger writes. The observable contract
  (args, effects, errors) is unchanged; only the client call site differs
  (`useAction` vs `useMutation`).

## Verification

- `pnpm test:convex` → **14/14** (6 new item tests: contribute happy path,
  permission gating, **C-19 EXIF rejection**, ledger-seq increment, markAvailable/
  withdraw state machine, non-custodian edit forbidden).
- Playwright (live backend) → **5/5**, incl. a new contribute e2e: login → form →
  canvas image processing → upload → `contribute` action → item persisted
  (confirmed in `items`/`ledgerEntries`).
- All packages typecheck; client + SSR build succeeds.

## Notes

- convex-test (0.0.35) doesn't implement the `storage.getMetadata` syscall, so
  `verifyPhotos` reads size/type from the fetched `Blob` (`blob.type`/`blob.size`)
  rather than `getMetadata` — fewer syscalls and test-compatible.
- No admin categories UI yet; a couple of categories were seeded into the dev
  backend via `convex import` to exercise the flow. The categories editor lands
  with the admin UI.

## Next (Step 3)

`items.list` paginated search (§17) + `items.get` / `items.ledger`; the `/items`
catalog grid and `/items/:id` page with the ledger timeline.
