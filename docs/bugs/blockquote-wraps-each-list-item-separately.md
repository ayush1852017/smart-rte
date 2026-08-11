# Applying Blockquote to a multi-item list selection wrapped each item in its own quote

**Status:** Fixed
**Area:** block
**First reported:** unknown — backfilled from `docs/PHASE_8B_BLOCKQUOTE_LIST_DEFECT.md`
**Related files:** `docs/PHASE_8B_BLOCKQUOTE_LIST_DEFECT.md`

## Symptom

Creating a list with 2+ items, selecting them, and applying Blockquote produced one `blockquote` per selected list item instead of a single `blockquote` wrapping the whole list — violating the rule that a quote containing a list wraps the whole list once.

## Reproduction

On the canonical product surface (`?canonicalAuthority=1`): create a 2+ item list, select the items, apply Blockquote. Reproduced cleanly, canonical-only — the retained/legacy engine did not have this defect (confirmed via `blockShadowComparator.test.ts`).

## Root cause

`wrapBlocks` grouped selected block IDs as independent siblings and never promoted selected descendants to their containing list node before building the wrapper (`packages/core/src/foundation/block/commands.ts:124-157` at the time).

## Fix

`wrapBlocks` now resolves the nearest `semanticRole: "list"` ancestor for every selected block, de-duplicates those ancestors, and emits one replacement per list. Non-list sibling groups keep prior grouping behavior. `unwrapBlocks` got the symmetric fix — ancestor lookup, de-dup, restore the wrapper's children as complete nodes with no ID regeneration.

## Regression coverage

- `packages/core/src/foundation/block/commands.test.ts` — multi-item list becomes exactly one quote containing the list; unwrap restores byte-identical structure/IDs.
- `packages/react/src/test-harness/blockShadowComparator.test.ts` — confirms the retained legacy blockquote command already wrapped once (control, no regression there).

## Related/similar issues

None identified with the same root cause. See [enter-split-loses-inline-marks](enter-split-loses-inline-marks.md) for another block/mark-layer fix from the same investigation era, unrelated cause.
