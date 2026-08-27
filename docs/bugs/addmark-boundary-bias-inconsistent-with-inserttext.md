# A concurrent insertion exactly at a mark's end boundary is order-dependent under rebase

**Status:** Open (deliberately not fixed in Phase 12b-client - narrow, pre-existing, disclosed)
**Area:** core / operations.ts (`mapOperation`'s addMark/removeMark range bias) vs. `insertText`'s own boundary convention
**First reported:** 2026-08-27, found while building Phase 12b-client's TP1 property tests for suggestion marks.
**Related files:** `packages/core/src/foundation/operations.ts` (`mapOperation`'s hardcoded `to: bias=1` for addMark/removeMark ranges), `packages/core/src/foundation/collab/rebase.property.test.ts` ("known limitation" test)

## Symptom

A suggestion mark (or, by the same mechanism, a comment or structural-suggestion range) covering `[0, 3)`, concurrent with a plain text insertion landing at exactly offset 3 (the mark's own end boundary), converges to a *different* result depending on which transaction is rebased through which: one order leaves the inserted text outside the mark, the other extends the mark to include it.

## Reproduction

`packages/core/src/foundation/collab/rebase.property.test.ts`, "known limitation: concurrent insertion exactly at a mark's end boundary is order-dependent" - a minimal, deterministic repro (offset exactly 3, not a random sweep hit).

## Root cause

Two independently-built mechanisms disagree about what "insert exactly at a mark's end boundary" should mean:

- `mapOperation`'s addMark/removeMark range-endpoint transform hardcodes `bias=1` for the `to` endpoint - "an insertion exactly at this boundary grows the range to include it."
- `applyToSession`'s own `insertText` handling, applied "live" (not through a rebase), has its own independent convention: new, unmarked text inserted exactly at the end of a marked run joins the *following* unmarked run, not the preceding marked one.

Whichever operation is applied live first wins with its own convention; whichever is rebased through the other inherits `mapOperation`'s hardcoded `+1` instead - these were never required to agree before this phase, since `mapOperation` had no production callers (see `mapoperation-position-arithmetic-gaps.md`).

## Fix

Not fixed in this pass. Changing the hardcoded bias risks regressing whatever behavior comments or structural suggestions currently rely on it for (e.g. "does a comment grow when you type right after the commented text" may be an intentional product decision elsewhere in the codebase) - investigating and changing that is out of this phase's scope. Documented and covered by a dedicated test asserting the *current* (divergent) behavior, so a future fix has a concrete regression target and this doesn't get silently rediscovered as a fresh bug.

## Regression coverage

The dedicated "known limitation" test above pins current behavior (`expect(leftDoc).not.toEqual(rightDoc)`) - flip to `toEqual` if/when this is fixed. The general suggestion-mark TP1 sweep deliberately excludes the exact-boundary offset so it isn't accidentally weakened to tolerate this gap.

## Related/similar issues

- [mapoperation-position-arithmetic-gaps](mapoperation-position-arithmetic-gaps.md) - the broader finding that `mapOperation` had zero production callers before this phase, which is why this inconsistency was never caught earlier.
- [concurrent-rebase-non-transformable-conflicts](concurrent-rebase-non-transformable-conflicts.md) - similar "two mechanisms built independently disagree" shape, but those were resolved as explicit conflicts; this one is narrower (a purely cosmetic mark-boundary difference, not data loss or corruption) and left open rather than force-fit into the conflict path.
