# Adding a column to a table with no real columnWidths shrank it

**Status:** Fixed
**Area:** core / table commands
**First reported:** 2026-08-20, "Adding a column to a table copied from Sootr shrinks the table" (Codex work order, 3 confirmed table bugs).
**Related files:** `packages/core/src/foundation/table/commands.ts` (`insertTableColumnCommand`).

## Symptom

Pasting a table from a real Sootr document (no real per-`<col>` pixel width data, correctly left with no `columnWidths` per the all-or-nothing import rule) and then using "Add column" made the table visibly shrink.

## Reproduction

Confirmed directly with the real `packages/react/e2e/fixtures/test-html-sootr.html` fixture (its table's `<col>` elements are genuinely empty - no width attribute or style). Pasting it produces `table.attrs.columnWidths === undefined`, rendering at natural (`width:100%`) size. Clicking "Add column" set `columnWidths` to a fabricated `[120, 120, 120]` - the renderer then pins the table's own width to that literal sum (per `docs/bugs/table-resize-moves-unrelated-columns.md`'s fix), visibly shrinking a table that had been rendering correctly.

## Root cause

Checked against the shared hypothesis from the work order first: yes, a sibling instance of the exact fabricated-fallback pattern `docs/bugs/table-resize-shrinks-table-with-no-prior-columnwidths.md` fixed for resize, found here in insert. `insertTableColumnCommand` (`commands.ts`, then around line 211): `const widths = Array.isArray(beforeAttrs.columnWidths) ? [...beforeAttrs.columnWidths] : Array(grid.columns).fill(120);` - the `Array(grid.columns).fill(120)` fallback ran unconditionally whenever `columnWidths` was absent, fabricating a full array and writing it to the model, instead of leaving `columnWidths` unset the way `removeTableColumnCommand` (checked as a comparison point) already correctly does in the equivalent situation.

## Fix

`insertTableColumnCommand` now only extends `columnWidths` when the table already has real per-column data (`Array.isArray(beforeAttrs.columnWidths)`); when it doesn't, no `columnWidths`-setting operation is emitted at all, leaving the table at its natural width with one more column, exactly as if the original import had included that column from the start.

## Regression coverage

- `packages/core/src/foundation/table/table.test.ts`:
  - "insertTableColumnCommand does not fabricate columnWidths for a table that never had any"
  - "insertTableColumnCommand still extends real columnWidths when the table already has them" (unchanged-behavior control)
- `packages/react/e2e/canonical-authority.spec.ts` - "adding a column to a pasted table with no real column widths does not shrink it": pastes the real Sootr fixture, adds a column, asserts `columnWidths` stays `undefined` and the table stays above 80% of the editor's width.

## Related/similar issues

- [table-resize-shrinks-table-with-no-prior-columnwidths](table-resize-shrinks-table-with-no-prior-columnwidths.md) - the original instance of this exact fallback pattern, for resize instead of insert.
- [table-shrinks-after-paste](table-shrinks-after-paste.md) - the fix that made a table with genuinely absent `columnWidths` reachable in the first place.
- [table-resize-handles-stale-after-structural-change](table-resize-handles-stale-after-structural-change.md) - found investigating the *next* symptom in the same work order (resizing after this same insert produced wildly wrong results); a different, independent bug, not caused by or a consequence of this one, but discovered via the same reproduction chain.
