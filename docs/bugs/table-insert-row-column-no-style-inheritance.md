# New table rows/columns did not inherit the adjacent row/column's cell style

**Status:** Fixed (new capability, not a broken-feature fix - see Root cause)
**Area:** core / table commands
**First reported:** 2026-08-20, "Adding a row/column doesn't inherit the last row/column's style" (Codex work order, 3 confirmed table bugs).
**Related files:** `packages/core/src/foundation/table/commands.ts` (`insertTableRowCommand`, `insertTableColumnCommand`).

## Symptom

A table with a styled last row/column (custom border colour, background colour, etc.) - using "Add row"/"Add column" produced a new row/column with default/blank styling instead of matching the adjacent one.

## Reproduction

Confirmed current behaviour first, per the work order's explicit instruction, before assuming a fix shape: both `insertTableRowCommand` and `insertTableColumnCommand` built new cells via `emptyCell(cellId, paragraphId, header)`, which only ever set `rowspan`/`colspan`/`header` - no style attrs were read, copied, or attempted at all. **This is new capability, not a broken inheritance attempt** - there was never any inheritance logic to be broken.

## Root cause

N/A (new capability, not a defect) - see Symptom.

## Fix

Confirmed with the owner's stated intent: new rows/columns inherit the immediately adjacent (last) row/column's cell-level style attributes - `background`, `borders`, `textColor`, `verticalAlign` (the schema's current full set of per-cell style attrs, per the Phase 11.5 table/color-picker audit) - as their default, not blank. Structural attrs (`rowspan`, `colspan`, `header`) are unaffected and continue to be set fresh, not inherited.

- `commands.ts` gained a shared `cellStyleAttrs(node)` helper (extracts just the four style keys from a cell's attrs) and `consumeEmptyCells` gained an optional `styleAttrsFor(index)` callback.
- `insertTableRowCommand`: for each new cell, looks up the corresponding column position in the adjacent existing row (the row immediately before the insertion index - "the last row" for the common append case - or immediately after it, if inserting before every existing row) and inherits its style.
- `insertTableColumnCommand`: symmetric, per row position, from the adjacent existing column.
- Inheritance is genuinely per-position, not "copy the whole adjacent row/column's style onto every new cell" - if only one cell in the adjacent row/column was styled, only the new cell at that same position inherits it; the others correctly stay unstyled. Confirmed via test (see below), including a case that initially exposed a wrong assumption in the test itself before the real per-position behavior was understood.

## Regression coverage

- `packages/core/src/foundation/table/table.test.ts`:
  - "insertTableRowCommand inherits the adjacent (preceding) row's cell style"
  - "insertTableRowCommand inserted before every row inherits from what was originally the first row"
  - "insertTableColumnCommand inherits the adjacent (preceding) column's cell style"
- `packages/react/e2e/canonical-authority.spec.ts` - "adding a row or column inherits the adjacent row/column's cell background colour": sets one cell's background via the real context-menu color picker, adds a row then a column, asserts inheritance follows the exact column/row position of the originally-styled cell (not a uniform "everything gets colored" check - the first version of this test asserted that incorrectly and was corrected after the real per-position behavior was confirmed against the model directly).

## Related/similar issues

None prior - this is new capability in an area (table cell style) covered by the Phase 11.5 table/color-picker audit's attribute-lifecycle table, but that audit did not flag insert-time inheritance as a gap since it was never a declared requirement before this work order.
