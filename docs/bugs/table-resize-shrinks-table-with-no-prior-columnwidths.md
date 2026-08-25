# Resizing a column of a freshly-pasted table (no columnWidths yet) shrank the whole table

**Status:** Fixed
**Area:** core / table commands / react resize UI
**First reported:** 2026-08-20, immediate follow-up to `docs/bugs/table-shrinks-after-paste.md`.
**Related files:** `packages/core/src/foundation/table/commands.ts` (`setTableColumnWidthCommand`), `packages/core/src/foundation/table/types.ts` (`ColumnWidthParams`), `packages/react/src/components/TableResizeHandles.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`resizeTableColumn`).

## Symptom

A table pasted without real per-column width data (correctly rendering at its natural, stretched width per the fix above) shrank the instant any single column was resized by even a small amount.

## Reproduction

Confirmed directly: a 3-column table with no `columnWidths` attribute, resizing only the last column via the drag handle. `setTableColumnWidthCommand`'s own fallback for a table with no existing `columnWidths` is `Array(grid.columns).fill(120)` - reasonable when nothing else is known, but this fallback ran on *every* resize of a still-unset table, including the very first one, silently setting every column *other* than the one being dragged to a fabricated 120px. Since the renderer pins the table's own rendered width to the literal sum of `columnWidths` (the fix this same investigation window produced), that sum was now dominated by fabricated 120px entries - the table visibly shrank.

## Root cause

The command layer has no access to a table's real *rendered* column widths - that's DOM state, not model state - so its only option when `columnWidths` is unset is to guess. The one place that *does* know the real widths is `TableResizeHandles.tsx`, which already measures every column's current `getBoundingClientRect()` width for handle positioning; that data just wasn't being passed through to the command.

## Fix

`ColumnWidthParams` gained an optional `widths?: readonly number[]` - when supplied, it seeds the full `columnWidths` array instead of the `Array(columns).fill(120)` fallback (falling back to 120 only for individual missing/invalid entries within the seed, not the whole array). `TableResizeHandles.tsx`'s `onResizeColumn` callback now also passes every column's current measured width (`columnsRef.current.map(b => b.size)`, read through a ref to avoid a stale closure without widening the pointer-listener effect's dependencies); `CanonicalAuthorityEditor.tsx`'s `resizeTableColumn` forwards it as `params.widths`.

## Regression coverage

- `packages/core/src/foundation/table/table.test.ts` - "setTableColumnWidthCommand seeds columnWidths from params.widths instead of fabricating 120 for other columns": both the old fallback behavior (still correct/unchanged when no seed is given) and the new seeded behavior (other columns keep their real values).
- `packages/react/e2e/canonical-authority.spec.ts` - "resizing one column of a table with no prior columnWidths does not shrink the others": a real 3-column table with no `columnWidths`, drags the last column's handle, asserts the other two columns' rendered widths stay within a few pixels of their pre-drag values.

## Related/similar issues

[table-shrinks-after-paste](table-shrinks-after-paste.md) - the fix that made this reachable (a table can now genuinely have no `columnWidths` after a normal paste); both closed in the same investigation window.
