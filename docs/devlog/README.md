# Development log

Chronological record of implementation work on Stwrd,
organized by the spec's five implementation phases (§21). Each entry documents
what was built, why, how it was verified, and any deviations from `spec.md`.

| # | Entry | Phase | Status |
|---|---|---|---|
| 0000 | [Project setup & environment](0000-project-setup.md) | — | ✅ Done |
| 0001 | [Phase 1: Foundation (backend)](0001-phase1-foundation.md) | 1 | ✅ Done |
| 0002 | [Phase 1: Frontend (auth surfaces)](0002-phase1-frontend.md) | 1 | ✅ Done |
| 0003 | [Phase 2 · Step 1: Taxonomy (categories + tags)](0003-phase2-step1-taxonomy.md) | 2 | ✅ Done |
| 0004 | [Phase 2 · Step 2: Media pipeline + contribution](0004-phase2-step2-contribution.md) | 2 | ✅ Done |
| 0005 | [Phase 2 · Step 3: Catalog & item page + ledger timeline](0005-phase2-step3-catalog.md) | 2 | ✅ Done |
| 0006 | [Phase 2 · Step 4: Claim & two-party handoff protocol](0006-phase2-step4-claim-handoff.md) | 2 | ✅ Done |
| 0007 | [Phase 2 · Step 5: Expiry cron & lifecycle polish](0007-phase2-step5-expiry-polish.md) | 2 | ✅ Done |
| 0008 | [Phase 3: Stewardship](0008-phase3-stewardship.md) | 3 | ✅ Done |
| 0009 | [Phase 4: Branches & inbound email](0009-phase4-branches-inbound.md) | 4 | ✅ Done |
| 0010 | [Phase 5: Polish & ops](0010-phase5-polish-ops.md) | 5 | ✅ Done |

## Conventions

- **Status legend:** ✅ Done · 🚧 In progress · ⏭️ Deferred · ⚠️ Deviation
- Every entry cross-references the normative `spec.md` sections it implements.
- Deviations from the spec are called out explicitly in a **Deviations** section
  so they are never silent.
- Verification evidence (commands run, outputs observed) is recorded so the work
  is reproducible.
