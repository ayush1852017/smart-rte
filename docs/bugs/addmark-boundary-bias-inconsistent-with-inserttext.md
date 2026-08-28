# A concurrent insertion exactly at a mark's end boundary was order-dependent under rebase

**Status:** Fixed (2026-08-28, required follow-up before Phase 12b-client §2 could proceed)
**Area:** core / operations.ts (`mapOperation`'s addMark/removeMark range bias) vs. `insertText`'s own boundary convention
**First reported:** 2026-08-27, found while building Phase 12b-client's TP1 property tests for suggestion marks. Initially left open as a disclosed limitation; escalated the next day to a required fix once TP1 impact was formally checked (see below) and confirmed to be an actual convergence violation, not just a cosmetic inconsistency.
**Related files:** `packages/core/src/foundation/operations.ts` (`mapOperation`'s `addMark`/`removeMark` range bias, ~line 488-489), `packages/core/src/foundation/collab/rebase.property.test.ts` (the boundary test)

## Symptom

A suggestion mark (or, by the same mechanism, a comment or structural-suggestion range) covering `[0, 3)`, concurrent with a plain text insertion landing at exactly offset 3 (the mark's own end boundary), converged to a *different* result depending on which transaction was rebased through which: one order left the inserted text outside the mark, the other extended the mark to include it.

## TP1 impact (checked before anything else, per the follow-up prompt's own instruction)

**Genuine TP1 violation, not a cosmetic-only inconsistency.** Direct check: apply `insertText` then the rebased `addMark`, vs. apply `addMark` then the rebased `insertText`, from the same base document (`"0123456789"`, mark `[0,3)`, insert `"X"` at offset 3):

- Order 1 result: `"012X"` marked + `"3456789"` unmarked.
- Order 2 result: `"012"` marked + `"X3456789"` unmarked.
- `JSON.stringify` equality: **false**. The two orders produce genuinely different documents, not just superficially different intermediate representations of the same content - this blocks exit gate 9 outright and was treated as stop-condition severity, not a cleanup item.

## Pre-existing vs. new

**Pre-existing**, confirmed not introduced by this phase's own code. Both halves of the disagreement predate Phase 12b-client: `mapOperation`'s hardcoded `to: bias=1` for addMark/removeMark ranges has been there since the function was built in Phase 8c; `insertText`'s own boundary-merge behavior (`splitInlineAt`/`normalizeInline` in `applyToSession`) predates that further, back to Phase 4's mark engine. The inconsistency was never exercised because `mapOperation` had **zero production callers anywhere in the codebase** before this phase (see `mapoperation-position-arithmetic-gaps.md`) - nothing ever needed the two mechanisms to agree with each other until a real rebase path started calling `mapOperation` for the first time.

## Root cause

Two independently-built mechanisms disagreed about what "insert exactly at a mark's end boundary" should mean:

- `mapOperation`'s addMark/removeMark range-endpoint transform hardcoded `bias=1` for the `to` endpoint - "an insertion exactly at this boundary grows the range to include it."
- `applyToSession`'s own `insertText` handling (`splitInlineAt`, `operations.ts` ~line 81-109): at an exact run boundary, the preceding node's text is placed entirely on the `before` side with nothing carried to `after`, so a newly-inserted plain-marks text node lands adjacent to (and, via `normalizeInline`, merges with) the *following* unmarked run - it never inherits the preceding run's marks.

## Fix

`mapOperation`'s addMark/removeMark `to` endpoint bias changed from `1` to `-1` (`operations.ts`, the `map(operation.range.to, ...)` call at the end of `mapOperation`), matching `insertText`'s existing, unexamined-until-now resolution rather than inventing a new one for either side. `bias` is only consulted at the exact-tie case inside `mapPosThroughOperation` (confirmed by grep - lines 322, 364, 372-373, 416 are the only consultation sites), so this change is scoped precisely to the ambiguous-boundary case and cannot affect any non-boundary offset.

**Confirmed scoped correctly, not a regression elsewhere:** the entire pre-existing test suite (704 core tests predating this phase, including Phase 4's mark engine tests and the post-11.5/12a comment and structural-suggestion range tests) passed unchanged after the fix - same 714/714 total as before this specific change, since only one test (this bug's own, previously asserting the divergence) needed updating. Full e2e: 468 passed / 7 skipped / 2 failed (the same pre-existing, unrelated Firefox clipboard-seeding flake); a first full run reported additional failures under heavy resource contention (a 1.4-hour run vs. the usual ~4 minutes) and all of those passed cleanly on isolated re-run, confirming transient flake rather than a real regression from this change.

## Regression coverage

The dedicated test (renamed from "known limitation... is order-dependent" to "...now converges (was a known, disclosed divergence)") now asserts `toEqual` instead of `not.toEqual`, and additionally pins the *specific* resolution (`"X"` lands on the unmarked, following side) rather than only checking the two orders agree with each other. The general suggestion-mark TP1 sweep's offset range was widened from `4..7` (excluding the boundary) to `3..7` (including it), since generic random coverage would not reliably have caught this on its own - it depends on the insertion landing at the *exact* offset the mark ends at, a single specific value out of the sweep's range, not a broad region; this is the same reason this project's testing convention treats named, explicit edge cases as necessary alongside generic seeded sweeps rather than a substitute for them (mirroring how generic operation-type coverage repeatedly missed table-specific bugs elsewhere in this phase and prior ones).

## Related/similar issues

- [mapoperation-position-arithmetic-gaps](mapoperation-position-arithmetic-gaps.md) - the broader finding that `mapOperation` had zero production callers before this phase, which is why this inconsistency (and several arithmetic bugs) were never caught earlier.
- [concurrent-rebase-non-transformable-conflicts](concurrent-rebase-non-transformable-conflicts.md) - similar "two independently-built mechanisms disagree" shape, but those were resolved as explicit conflicts (no safe automatic answer exists); this one had a real, existing ground truth (`insertText`'s own resolution) to align to instead.
