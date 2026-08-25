# Row resize did nothing at all when every row in the table was already at its natural content floor

**Status:** Fixed (a regression introduced by the fix in `row-resize-drag-up-only-grows-the-row-below.md`, caught within the same investigation window)
**Area:** react / TableResizeHandles.tsx
**First reported:** 2026-08-21, "row resize not working. Couldn't able to drag up or down."
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`.

## Symptom

After the fix for "dragging a row boundary up only grows the row below" landed, row resize stopped doing anything at all on a freshly-created or freshly-pasted table (the common case: short, unstyled cell text with no explicit extra height) - neither dragging up nor down visibly moved either row.

## Reproduction

Confirmed directly: on a default `Insert table` (2 empty rows, natural height ~54.6px each - already at the floor described in the related bug below), dragging the boundary between them **down** by 40px left both rows completely unchanged (54.59 → 54.59, and 54.59 → 55). Dragging **up** by the same amount also did nothing, as expected (that direction was already correctly floor-limited).

## Root cause

The immediately preceding fix (`row-resize-drag-up-only-grows-the-row-below.md`) made *both* rows' resulting sizes depend on measuring how much the *shrinking* side could actually give up, then applying only that real amount to whichever side was growing - correct for the shrinking side (a `<tr>` genuinely cannot render below its content's natural height, no override exists) but wrongly applied the same conditional logic to the *growing* side too. Growing a row has no equivalent ceiling - CSS always lets a `<tr>`'s height increase - so there was never a reason to gate the dragged row's growth on whether its neighbor had room to shrink. On a table where every row already sits at that same natural floor (true of nearly any freshly-created or freshly-pasted table), the neighbor could never give up any space, and the conditional logic then blocked the dragged row from growing too - even though nothing about CSS or content actually prevented it. The net effect: an internal row-boundary drag on such a table could not change anything in either direction.

## Fix

Split the two directions apart. Dragging up (the dragged/above row shrinking) is unchanged - still floor-limited, with the neighbor below receiving only whatever was actually ceded, exactly as fixed previously. Dragging down (the row below shrinking to make room for the dragged row's growth) now grows the dragged row by the *full* requested amount unconditionally, and asks the neighbor to shrink by that same amount - but if the neighbor is floor-limited and can't give up all of it, the shortfall is simply absorbed as real growth in the table's total height, rather than blocking the drag. When the neighbor *does* have real room to give (the common non-floor-limited case), this produces byte-identical results to the strict "redistribute, keep total constant" behavior - the relaxation only kicks in exactly when the strict version would otherwise refuse to do anything.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "dragging a row boundary down grows the dragged row even when the row below has no room to shrink": on a freshly-inserted table (both rows at their natural floor), drags the boundary down and asserts the dragged row visibly grows (both mid-drag and in the committed model), confirmed across all 3 browsers. The existing "resizing an internal row boundary redistributes..." and "row resize handle tracks the live row border..." tests (both using a 150px-starting-height fixture with real slack) continue to pass unmodified, confirming the common/roomy case is unaffected.

## Related/similar issues

[row-resize-drag-up-only-grows-the-row-below](row-resize-drag-up-only-grows-the-row-below.md) - the fix this one refines; that fix's own diagnosis (a `<tr>`'s height is a floor, not a cap) was correct, but its remedy was applied too broadly (to the growing side as well as the shrinking side), which is what this fix narrows.
