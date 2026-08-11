# Projected table-cell selection was demoted to text and made merge unreliable

**Status:** Fixed
**Area:** table / selection / renderer / input
**First reported:** 2026-08-05 (the cell-selection and vertical-merge repair sequence)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md`

## Symptom

Dragging or selecting cells—especially a vertical range—could show a highlight briefly, then lose the semantic cell selection. Merge/split controls became unavailable or a generated replay observed a text selection instead of the selected cells.

## Reproduction

On the canonical surface, drag from one cell to another and inspect `editor.selection.type`; the renderer's projected native range could trigger `selectionchange`, after which the model no longer reported `type: "cell"`. A vertical two-cell selection then failed to provide the scope required by Merge cells.

## Root cause

Cell selection is model-semantic but is projected as a native DOM range/highlight. `syncSelectionFromDom` treated the browser's range for that projection as a new text selection. The same race also occurred after a structural table operation when a selected head cell was retired. This was a selection bridge/runtime mapping issue, not occupancy geometry or merge semantics.

## Fix

`packages/core/src/foundation/surface/input.ts:1416-1425` preserves a cell selection while native endpoints still match its anchor/head, while a genuinely different click or drag continues through normal mapping. The renderer projects `data-smart-cell-selected`; the runtime preserves cell IDs through structural operations and reconstitutes the cell selection against the preview document.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` (`selects a vertical cell range and merges it`) and the generated table-merge replay in `packages/react/e2e/canonical-authority.spec.ts:374-375` wait for semantic `type: "cell"` before invoking Merge cells. The focused replay and full three-browser suite pass.

## Related/similar issues

- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — same native `selectionchange` demotion pattern, different semantic selection kind.
- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — stale native selection after stable-ID DOM reordering, a different renderer mechanism.
- [table-merge-multiplies-row-height](table-merge-multiplies-row-height.md) — merge content/presentation behavior, not cell-selection resolution.
