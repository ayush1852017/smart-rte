# Plain ArrowLeft/ArrowRight collapsed a selection to the wrong endpoint depending on drag direction

**Status:** Fixed
**Area:** selection / input
**First reported:** unknown — backfilled from `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`

## Symptom

The same range, selected in reverse (anchor after head, i.e. a backward drag) vs. forward, collapsed to different positions on plain ArrowLeft/ArrowRight — the expected document-order endpoint wasn't used, so the same visual selection could behave inconsistently depending on how the user dragged to create it.

## Reproduction

Reproduced directly at the model/input level (not browser-flake dependent) — not something that required a specific browser or timing condition.

## Root cause

The plain-arrow key handler in `packages/core/src/foundation/surface/input.ts` read `selection.head` directly to decide the collapse target. `head` legitimately changes meaning with drag direction (it's "wherever the drag ended," not "the rightmost/leftmost point"), so a reverse drag made Left/Right collapse to the wrong endpoint relative to document order.

## Fix

The handler now computes `normalizedRange(selection)` and uses `range.from` for ArrowLeft, `range.to` for ArrowRight — restricted to non-collapsed *text* selections, so node/cell (atom/table) navigation keeps its existing, separate behavior.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`: forward and reverse selections each collapsed with Left/Right must produce identical document-order endpoints. No retained-engine equivalent exists (this is a canonical-only input handler); no retained regression observed.

## Related/similar issues

None identified with the same root cause.
