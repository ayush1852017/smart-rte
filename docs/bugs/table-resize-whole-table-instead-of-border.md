# Resizing an internal column/row boundary changed the whole table instead of just moving the border

**Status:** Fixed (design change, not a defect in the prior behavior - see Root cause)
**Area:** react / TableResizeHandles
**First reported:** 2026-08-20, "why resizing column or row effect whole table? I want border to move only. If user increase or decrease rightmost column then only table width matters."
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`, `packages/core/src/foundation/table/commands.ts` (`setTableRowHeightCommand`, unchanged - called twice instead of once).

## Symptom

In a 3x3 table, dragging the boundary between column 2 and column 3 grew column 2 and left both column 1 *and* column 3 untouched - so the table's total width grew by the drag distance, instead of column 3 giving up what column 2 gained (the way a spreadsheet or word processor's internal column-boundary drag behaves).

## Reproduction

Confirmed this was the deliberate, working-as-designed behavior from round 1 (`table-resize-moves-unrelated-columns.md`) and its own regression test (`"previews table column resize live during the drag, and other columns stay independent"`) - re-run before making any change, passing, explicitly asserting column 3 stays put. Not a bug in the prior sense; the owner is asking for different behavior than what was deliberately built.

## Root cause

N/A (design change) - round 1's design was "every column resize only ever changes that one column, and the table's own width follows"; the requested design is "an internal boundary redistributes between its two neighbors, keeping total width constant; only the last column/row's own outer edge changes the table's total size." Both are internally consistent, well-defined behaviors - this is a product decision, not a defect.

## Fix

`TableResizeHandles.tsx`: `startDrag` now also records the *next* sibling's starting size (`nextStartSize`/`nextIndex`), `null` for the last boundary (no neighbor to redistribute with). During drag, the raw pointer delta is clamped so neither side ever goes below `MIN_SIZE`, then applied with opposite signs to both sides - their sum is therefore always exactly `startSize + nextStartSize`, whatever the clamp did, which is what makes "the border just moves" true without the table's own total size ever needing to change for an internal drag. The last boundary (no neighbor) keeps the prior behavior unchanged: it still grows/shrinks the table's own total width/height, matching "if user increase or decrease rightmost column then only table width matters."

For columns, committing both new widths reuses the *existing* `setTableColumnWidthCommand`/`currentWidths`-seed mechanism unchanged - the caller just pre-fills the neighbor's new value into the seed array before calling it, so both changes land in one command call. For rows, `onResizeRow` gained an optional `adjacent: { index, height }` parameter; `resizeTableRow` in `CanonicalAuthorityEditor.tsx` builds two `setTableRowHeightCommand` operations (against the same starting document) and commits them together as one operation batch/undo step.

Several existing tests encoded the *old* design as their explicit assertion and needed rewriting, not just re-running clean - `"previews table column resize live during the drag, and other columns stay independent"` (renamed, its own assertion inverted: the adjacent column now *must* change, the far column must not) and `"resizing a column boundary after inserting a column only affects the adjacent column"` (its assertion on the far column changed from "stays put" to "the pair's total width is unchanged" - its comment already said "must only change those two", the assertion just hadn't matched that yet).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`:
- "previews table column resize live during the drag, redistributes with the adjacent column, and leaves the far column and table width untouched" (rewritten from the round-1 test)
- "resizing the last column's own edge changes the table's total width, with no neighbor to redistribute with" (new - the symmetric "only the rightmost edge" case)
- "resizing a column boundary after inserting a column only affects the adjacent column" (assertion updated, same test name/scenario)
- "resizing an internal row boundary redistributes with the adjacent row, leaving a distant row and the pair's total height untouched" (new - the row case)

## Related/similar issues

[table-resize-moves-unrelated-columns](table-resize-moves-unrelated-columns.md) - the round-1 fix whose test this change intentionally supersedes for internal boundaries; its actual mechanism (pinning the table's own width to the literal `columnWidths` sum) is unchanged and still correct - this change only affects which columns' widths get set on release, not how the table's width is derived from them.
[table-resize-handles-stale-after-structural-change](table-resize-handles-stale-after-structural-change.md) - the same component, a different (already-fixed) mechanism (stale cached handle geometry after a structural edit).
