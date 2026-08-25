# Cell range selection appeared to highlight extra, non-rectangular cells

**Status:** Fixed (superseded - the original "not reproducible" conclusion below was correct about the *model*, but missed a second, real rendering-layer bug)
**Area:** table / selection / renderer
**First reported:** 2026-08-20, "I want to select r2c2 and r3c2 cells. But as soon I do that it show r2c2, r2c3, r3c1 and r3c2 highlighted. But yes if I click merge cells it only merge r2c2 and r3c2 cells."
**Re-reported:** 2026-08-20 (screenshot), "look at selected cells and also see column 3 row 2, column 1 row 3 content is selected. Even though cells aren't selected that's why no unexpected behaviour will gonna happen to those cells. But it looks confusing."
**Related files:** `packages/core/src/foundation/surface/renderer.ts` (`restoreSelection`, `syncCellSelectionProjection`), `packages/react/src/theme.ts`.

## Symptom

Dragging a vertical 2-cell range (e.g. row 2 col 2 through row 3 col 2) correctly highlighted exactly those 2 cells with the app's own blue `data-smart-cell-selected` border/background - but an unrelated intermediate cell (e.g. row 3 col 1, sitting between the drag's start and end in DOM row-major order) also showed the browser's native grey text-selection highlight. Merge, invoked afterward, correctly operated on only the 2 real cells, confirming (as the original investigation below also found) that the *model* selection was always correct - only the *native browser selection rendering* was misleading.

## Root cause

Two independent, non-overlapping things were going on:

1. **The model/rectangle-snap logic was never buggy.** `snapTableCellRect` (`packages/core/src/foundation/table/selection.ts`) only ever computes a single axis-aligned rectangle and only expands it to fully contain an intersected merged cell - it cannot produce a diagonal/offset shape. The original investigation (below) correctly ruled this out via 4 reproduction attempts, all of which only ever exercised the *model* and the app's own CSS-attribute highlight, never actually looking at the browser's separate native `Selection`/`::selection` rendering layer - which is why it found nothing despite the bug being real.
2. **`renderer.ts`'s `restoreSelection`** runs on every render for any non-`"none"` selection, including `"cell"`. For a `"cell"` selection it calls `selection.setBaseAndExtent(anchorDom, headDom)`, spanning from the start of the anchor cell's content to the end of the head cell's content. Table cells are DOM siblings in row-major order, so that native `Range` necessarily also covers any cell sitting between the anchor and head cells in DOM order (e.g. row 3 col 1, between "row 2 col 2's end" and "row 3 col 2's start") - and the browser renders its own grey `::selection` highlight across that entire span, not just the two logically-selected cells. This is inherent to how the Selection API works for any two boundary points in different, non-adjacent DOM containers; no alternative choice of boundary points inside the same two cells avoids it.

This native range is still required functionally: `handleCopy`/`handleCut` (`input.ts:678-690`) call `event.preventDefault()` and build the clipboard payload entirely from the *model* selection (`sliceClipboardSelection`, `packages/core/src/foundation/clipboard/transfer.ts:33` - confirmed it never reads the DOM `Range`), but the native `copy`/`cut` events themselves only fire when there is a real, non-collapsed native selection for the browser's Ctrl+C/Ctrl+X handling to act on. The `"cell"`-type preservation guard in `syncSelectionFromDom` (`input.ts:1630-1633`) also depends on the native anchor/head continuing to match the model's `anchor`/`head` positions, so `restoreSelection` re-establishing that exact range on every render is deliberate, not incidental.

An initial fix attempt called `selection.removeAllRanges()` once in `tableMouseUpListener` after forming the selection. This worked functionally but was flaky (~60% failure rate across 5 manual runs) in `canonical-toolbar-routing.spec.ts`'s merge/split tests: any render between the drag's end and a later "Merge cells" click (or a browser-level asynchronous self-healing of the focused-but-cleared contenteditable's selection) would call `restoreSelection` again, re-establishing the exact same native range the click just cleared, racing with `syncSelectionFromDom`.

## Fix

Left the native `Range` mechanics in `restoreSelection` completely unchanged (so `handleCopy`/`handleCut` and the `syncSelectionFromDom` preservation guard keep working exactly as before, with no new race). Instead suppressed the native selection's *visual rendering* with CSS, scoped to only while a cell selection is active:

- `syncCellSelectionProjection` now toggles a `data-smart-cell-selection-active` attribute on the editable root whenever `selection.type === "cell"` (and removes it otherwise).
- `theme.ts` adds `.srte-editor [contenteditable][data-smart-cell-selection-active] ::selection { background: transparent; color: inherit; }`, so the browser's own grey highlight renders invisibly while the `data-smart-cell-selected` rectangle (already correct) remains the only visible indicator.

This is zero-risk to the previously-flaky tests because nothing about the Range's endpoints, the `syncSelectionFromDom` guard, or the `tableMouseUpListener` drag-handling changed - only the browser's paint of an already-existing, unmoved selection.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts`:
- "suppresses the native text-selection highlight while a cell range is selected" (new): drag-selects a vertical 2-cell range in a 2Γ—2 table (intermediate cell row 1 col 2 sits between the drag's endpoints in DOM order), asserts the intermediate cell never gets `data-smart-cell-selected`, asserts the root's `data-smart-cell-selection-active` attribute is set, asserts `getComputedStyle(root, "::selection").backgroundColor` is transparent, then clicks outside the table and asserts the attribute is removed again (suppression doesn't leak into ordinary text selection).
- "selects canonical cells individually and supports merge/split" and "selects a vertical cell range and merges it" (pre-existing): re-verified stable across 5 repeated runs Γ— 3 browsers (45/45 passed) after this change, confirming the earlier `removeAllRanges()` flakiness is gone since that patch was fully reverted.

## Related/similar issues

- [right-click-drag-forms-unintended-multi-cell-selection](right-click-drag-forms-unintended-multi-cell-selection.md) - a different, already-fixed cell-selection defect in the same general area; not the cause here.
- [cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md) - a different, already-fixed failure mode (selection losing its `"cell"` type entirely, not a rendering-only artifact).
