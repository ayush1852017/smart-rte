# Resizing a column after inserting a row/column produced wildly wrong widths

**Status:** Fixed
**Area:** react / TableResizeHandles.tsx
**First reported:** 2026-08-20, "Resizing a middle column from the right affects an unrelated column" (Codex work order, 3 confirmed table bugs).
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`.

## Symptom

3+ column table, drag the resize handle on the boundary between two columns: a column that isn't adjacent to the dragged boundary changed width too - by a huge, wildly disproportionate amount relative to the drag distance, not a subtle proportional-scaling effect.

## Reproduction

The work order asked explicitly whether this is a regression of `docs/bugs/table-resize-moves-unrelated-columns.md` (round 1's `table-layout:fixed` fix) or a genuinely new bug - checked directly rather than assumed:

- **The exact scenario round 1's own regression test already covers** (a `replaceValue`-injected 3-column table with real `columnWidths` from the moment `TableResizeHandles` first mounts, no structural edit afterward) **still passes**, both before and after this fix - round 1's fix is intact and correctly implemented (re-read `surface/renderer.ts`'s table-width-pinning logic directly, unchanged).
- **The reported shape only reproduces after a structural edit happens while the same `TableResizeHandles` instance is already mounted** - concretely, pasting a table with no `columnWidths` (natural width, no `<colgroup>` in the DOM at all - see the sibling bug in `table-insert-column-fabricates-widths.md`), clicking "Add column", then dragging a resize handle. Instrumented `handleUp` directly: `drag.startSize` (captured at `pointerdown`) and `currentWidths` (read from `columnsRef.current` at `pointerup`) both reflected the table's **pre-insert, 2-column layout** - only 2 boundary entries existed for what was now a 3-column table, and the dragged handle's index no longer corresponded to the column it visually sat over. This produced a `size` computed from a stale, unrelated start width (e.g. inheriting what had been the *second* original column's ~929px width as the "start size" for what was now a ~23px newly-inserted column), not a wrong-but-proportionate value - explaining the "wildly disproportionate" symptom precisely.

**Conclusion: a genuinely new, different bug - not a regression of round 1's fix.** Round 1's mechanism (pinning the table's own width to the literal `columnWidths` sum) is unrelated to and unaffected by this; this is a stale-cache bug in a completely different part of the same file.

## Root cause

`TableResizeHandles.tsx`'s handle geometry (`columns`/`rows` state, each boundary's `position`/`size`) is only recomputed by a `ResizeObserver` bound to the table element (plus initial mount and window `scroll`). A `ResizeObserver` fires only when the **observed element's own box size** changes - inserting a row/column into a table that stays the same overall width (the common `width:100%` case, or any table whose sum of column widths doesn't change) never changes the table's own outer bounding box, so it never fires. The handles then keep referencing the table's pre-edit column/row count and geometry indefinitely, until something *else* happens to resize the table. Since `TableResizeHandles` receives the same `tableElement` DOM node reference across a structural edit (the renderer mutates the existing table node in place, it doesn't replace it), React doesn't remount the component or re-run its `useEffect(..., [tableElement])` either - there was no path back to a fresh measurement at all.

## Fix

Added a `MutationObserver` on `tableElement` (`{ childList: true, subtree: true }`) alongside the existing `ResizeObserver`, calling the same `recompute()` function. This catches exactly the class of change a `ResizeObserver` misses: row/column insert, remove, merge, split, or any other structural mutation to the table's own DOM, regardless of whether it happens to change the table's overall rendered size.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "resizing a column boundary after inserting a column only affects the adjacent column": pastes the real Sootr fixture (no `columnWidths`), adds a column, drags the boundary between the new column and the next one by 50px, asserts the non-adjacent column changes by less than 5px and the two adjacent columns change by an amount consistent with the drag distance (not hundreds of pixels).

## Related/similar issues

- [table-resize-moves-unrelated-columns](table-resize-moves-unrelated-columns.md) - the original, different bug this was checked against and ruled out as a regression of; confirmed still fixed and unaffected.
- [table-insert-column-fabricates-widths](table-insert-column-fabricates-widths.md) - the sibling bug found via the same reproduction chain (paste Sootr table, add column); independent of this one, but both needed fixing to make the full repro sequence behave correctly end to end.
