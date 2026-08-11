# Merging table cells multiplied row height instead of keeping it constant

**Status:** Fixed on the canonical model/content-assembly side. **Not fully fixed on the retained/legacy path** — flagged explicitly, not silently left broken.
**Area:** table
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md` ("bug 3")

## Symptom

Merging cells (horizontally, with simple one-line cell content) produced a 2×/3×/4× row-height blow-up instead of the merged row staying at its original height.

## Reproduction

Reproduced with a focused model/DOM regression fixture using horizontal merges of one-line cells.

## Root cause

**The obvious suspect — row-height arithmetic literally summing merged cells' heights — was tested and explicitly rejected.** Row height is stored once on `table_row`, and the table-placement logic already preserved that single row attribute correctly; no merge code was found summing cell heights. The actual cause was content assembly: each source cell contributed its own placeholder/one-line paragraph into the merged anchor cell, stacking N separate line boxes inside one row — which visually multiplied the apparent row height even though no height *number* was wrong. A stale cell-level `height`/`min-height`/`max-height` style left over from legacy DOM cell reuse could compound the effect further.

## Fix

`packages/core/src/foundation/table/commands.ts` now concatenates simple one-paragraph paragraph/heading content in reading order when merging (preserving marks/text, dropping empty placeholders) instead of stacking separate paragraphs. Complex merged content (multiple blocks, lists, quotes, block atoms) intentionally still retains block boundaries, since its height may legitimately grow — that's not a bug. `packages/core/src/foundation/surface/renderer.ts` now treats row height as row-level canonical state and strips stale cell-level `height`/`min-height`/`max-height` attributes during cell sync (a hygiene guard, not a height cap).

**What was explicitly left unfixed:** the retained/legacy DOM table bridge (`packages/react/src/adapters/domTableCommandBridge.ts`) still projects row height onto anchor cells directly; this path was not modified and is not claimed as corrected.

## Regression coverage

`packages/core/src/foundation/table/table.test.ts` (merges of 2/3/4 one-line cells, row height stays constant, text conserved in one anchor paragraph); `packages/core/src/foundation/phase2_5.test.ts` (stale cell-height presentation cleared, row height stays constant); `packages/react/e2e/canonical-toolbar-routing.spec.ts` (product merge route leaves one editable paragraph, no stacked empty placeholders).

## Related/similar issues

None identified with the same root cause. The retained-path gap noted above is worth checking before assuming this is fully closed if a report comes in against the legacy/retained editor specifically rather than the canonical one.
