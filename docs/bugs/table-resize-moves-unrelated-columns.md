# Table column resize had no live preview, and resizing one column moved unrelated columns

**Status:** Fixed
**Area:** react / core renderer / table resize
**First reported:** 2026-08-19, post-Phase-11.5 manual testing.
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`, `packages/core/src/foundation/surface/renderer.ts`.

## Symptom

Dragging a column resize handle wasn't smooth or live - nothing visibly updated until the drag ended. In a 3-column table, resizing the boundary between columns 2 and 3 also moved column 1, which should never be affected by a boundary it isn't adjacent to.

## Reproduction

Confirmed both symptoms directly against a controlled 3-column, 2-row table fixture. Investigating the "not smooth" symptom also surfaced a third, related defect: column and row resize handles are both full-length overlay elements that cross at every boundary intersection, and with no z-index difference between them, whichever rendered later in the DOM won pointer hit-testing at an exact overlap point - a column-drag started at a y-coordinate that happened to cross a row boundary silently grabbed the row handle instead.

## Root cause

1. **No live preview**: `TableResizeHandles.tsx` was commit-on-release by design (a deliberately bounded first pass, per its own doc comment) - nothing re-rendered during the drag itself, only on `pointerup`.
2. **Unrelated columns moving**: the stylesheet's `.srte-editor [contenteditable] table { width: 100% }` combined with the renderer's `table-layout: fixed` (set whenever `columnWidths` is present) makes every `<col>`'s specified width a *proportion* of the table's rendered width, not a literal pixel value - this is standard CSS `table-layout: fixed` behavior when the table's own width doesn't match the sum of its columns' widths. Growing one column's `<col>` width shifted the proportional split, visibly changing every other column's rendered width even though their `columnWidths` model entries were completely untouched. The underlying command (`setTableColumnWidthCommand`) was already correct - it only ever writes `widths[params.index]`; this was a rendering-layer effect, not a data bug.
3. **Handle hit-testing**: `TableResizeHandles.tsx` rendered column handles before row handles in the JSX - later-in-DOM wins pointer hit-testing at an exact pixel overlap with no z-index difference, so row handles (rendered second) won every intersection.

## Fix

- `packages/core/src/foundation/surface/renderer.ts`: pins the table's own inline `width` to the literal sum of `columnWidths` whenever a colgroup is rendered (and clears it when `columnWidths` is absent), overriding the stylesheet's `width: 100%` so `table-layout: fixed` gives each column exactly its specified pixel width instead of a proportional share.
- `packages/react/src/components/TableResizeHandles.tsx`: `handleMove` now mutates the real `<col>`/`<tr>` element directly during the drag (and keeps the table's own width in sync with the live sum, for the same reason as the renderer fix above) - commit-on-release is unchanged, only the visual feedback during the drag is new. Column handles now render after row handles, so a column drag wins any boundary-intersection tie.

## Regression coverage

- `packages/core/src/foundation/surface/tableColumnWidth.test.ts` - "pins the table's own width to the sum of columnWidths, overriding the stylesheet's width:100%".
- `packages/react/e2e/canonical-authority.spec.ts` - "previews table column resize live during the drag, and other columns stay independent": a 3-column table, dragging the boundary between columns 2 and 3, asserting both column 1's and column 3's rendered widths stay within a few pixels of their start *during* the drag (before release), and that the final model has the untouched columns still at their original values.
- Full existing table/resize e2e coverage re-run across all 3 browsers with no regressions.

## Related/similar issues

[table-column-width-not-rendered](table-column-width-not-rendered.md) - the Phase 11.5 fix that first made `columnWidths` render at all, which is what exposed this `table-layout: fixed` proportional-scaling behavior (it couldn't have been observed before that fix landed).
