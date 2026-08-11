# Production canonical input-to-paint exceeds the 20 ms target at 10,000 blocks

**Status:** Open — Phase 11 performance decision
**Area:** performance / renderer / production surface
**First reported:** 2026-08-11 (Phase 8b closeout performance run)
**Related files:** `docs/PHASE_8B_COMPLETION_REPORT.md`, `docs/PHASE_8B_DELTA_REPORT_2.md`

## Symptom

Typing into a 10,000-block production canonical document can exceed the 20 ms input-to-paint budget. The 2,000-block case is near the target, while the tail case shows materially higher DOM/layout/paint cost.

## Reproduction

Run the production-surface benchmark in `packages/react/e2e/canonical-authority.spec.ts` (`records 20 product input samples at 2000 blocks` and `at 10000 blocks`) with Chromium, Firefox, and WebKit. The focused 20-sample run recorded median/p95/worst values in this order:

- Chromium: 2k `16.6 / 17.5 / 23.6 ms`; 10k `27.2 / 33.8 / 34.6 ms`.
- Firefox: 2k `17 / 22 / 29 ms`; 10k `17 / 19 / 19 ms` (a noisy, non-monotonic sample).
- WebKit: 2k `16 / 32 / 55 ms`; 10k `33 / 44 / 46 ms`.

## Root cause

Not a model-command bottleneck: model work remains sub-millisecond. The cost is production DOM update, layout, and paint for a large mounted document. A headed `content-visibility` experiment was also run and was materially worse in this surface, so it is not an accepted fix.

## Fix

None yet. Keep the current renderer behavior stable and schedule a headed browser trace/content-visibility investigation in Phase 11. Do not use the noisy 2k-vs-10k Firefox sample as evidence that the tail problem is solved.

## Regression coverage

The 20-sample production benchmark reports median/p95/worst for all three browsers in `canonical-authority.spec.ts`; the full three-browser suite passes, but the performance target itself remains open until Phase 11 decides whether containment/virtualization is safe.

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — performance measurements must use the live-source playground/build path.
- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — renderer reconciliation correctness, not the same performance cause.
