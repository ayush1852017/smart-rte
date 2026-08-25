# Right-click near a shared cell border produced a multi-cell highlight

**Status:** Fixed
**Area:** core / table / selection / input
**First reported:** 2026-08-19, post-Phase-11.5 manual testing (screenshot showing a blue highlight extending past a single cell after right-clicking near a cell border).
**Related files:** `packages/core/src/foundation/surface/input.ts` (`tableMouseDownListener`, `tableMouseUpListener`).

## Symptom

Right-clicking near a table cell border produced a selection highlight extending well past what a simple right-click should ever select.

## Reproduction

Confirmed directly, not assumed: a `mousedown`(button 2)→`mousemove`→`mouseup`(button 2) sequence with the down/up points a few pixels apart, straddling the shared border between two cells (an entirely realistic simulation of a real hand's natural wobble between press and release - Playwright's default atomic `.click()` at a single fixed point did *not* reproduce this, since it never moves between down and up). Probing the actual native event sequence showed `mousedown → contextmenu → mouseup`, with `mousedown`'s target in one cell's paragraph and `mouseup`'s target in the adjacent cell's paragraph. Result: `editor.selection.type` became `"cell"` with 2 `data-smart-cell-selected` elements - a genuine, unintended 2-cell selection.

## Root cause

`surface/input.ts`'s `tableMouseDownListener`/`tableMouseUpListener` (native `"mousedown"`/`"mouseup"` listeners implementing left-click-drag cell-range selection - record an anchor cell on mousedown, form a `cellSelectionFromIds(anchor, head)` selection on mouseup if the two differ) never checked `event.button`. A right-click's own mousedown/mouseup pair reaches these exact same listeners. Any right-click whose press and release landed in different cells - trivially easy near a shared border - silently ran through the identical drag-selection logic a deliberate left-click-drag uses, forming a real multi-cell selection the user never intended to make.

## Fix

`tableMouseDownListener` now only starts the drag-selection gesture (records `tableDragAnchor`) for the primary (left) button; for any other button it explicitly clears `tableDragAnchor` and returns. `tableMouseUpListener` was already guarded by `if (!anchor || ...) return`, so clearing the anchor on a non-primary mousedown is sufficient - no separate button check was needed there.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`:
- "does not form a multi-cell selection from a right-click near a cell border" - the exact reproduction sequence, asserting `selection.type !== "cell"` and zero `data-smart-cell-selected` elements.
- "a left-click drag across a cell border still forms a real cell selection" - the same geometry with the primary button, confirming the guard didn't regress the legitimate feature (`selection.type === "cell"`, 2 selected cells).

Full existing table/cell e2e coverage (`canonical-authority.spec.ts`, `canonical-toolbar-routing.spec.ts`, `canonical-surface.spec.ts`) re-run across all 3 browsers with no regressions.

## Related/similar issues

[cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md) - same cell-selection subsystem, a different (already-fixed) failure mode.
