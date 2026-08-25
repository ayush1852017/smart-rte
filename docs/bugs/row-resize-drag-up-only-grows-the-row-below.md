# Dragging a row boundary up to shrink the row above silently only grew the row below instead

**Status:** Fixed, but this fix's own remedy was applied too broadly and caused a follow-up regression - see [row-resize-blocked-when-every-row-is-at-its-floor](row-resize-blocked-when-every-row-is-at-its-floor.md), fixed in the same investigation window.
**Area:** react / TableResizeHandles.tsx
**First reported:** 2026-08-20, "if i resize rows. click on icon hold and move cursor up then it is effecting below row height."
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`.

## Symptom

Dragging a row's resize handle upward - intending to shrink the row above the boundary - visibly did nothing to that row; instead, only the row below grew, as if the drag were somehow only "affecting" the wrong row. Confirmed the mechanism is symmetric and correct for a table whose rows already have real headroom (e.g. `attrs.height: 60` with only a single short word per cell has real slack above its content's minimum) - the bug only manifests when the row being shrunk is already at, or is pushed to, its natural content floor, which is exactly the common case for a freshly-inserted table (short/empty cells with no explicit slack).

## Reproduction

Confirmed directly on a default `Insert table` (empty 2-cell rows, no explicit height, natural row height ~54.6px): dragging the boundary between row 0 and row 1 upward by 25px left row 0's *rendered* height completely unchanged (54.59 → 54.59) while row 1 *grew* by the full 25px (54.59 → 80) - the row actually being dragged never moved at all; all the requested space silently landed on its neighbor instead.

## Root cause

`resolveSizes`' redistribution math (`packages/react/src/components/TableResizeHandles.tsx`) was purely arithmetic: it clamped the requested delta only against a fixed `MIN_SIZE` constant (20px) and handed the *exact same* delta, with the opposite sign, to the neighboring row - correct for columns, where `table-layout: fixed` genuinely allows a `<col>`'s width to be squeezed arbitrarily small (content just wraps). Rows don't have that property: a `<tr>`'s explicit `height` behaves as a *minimum*, not a hard cap, in table layout - the browser always renders a row tall enough to fit its own cell content, no matter how small a height is requested. A freshly-inserted table's rows sit right at that natural floor already (short/empty cell content, no real slack above it).

So the instant a row hit its real content floor, the arithmetic still computed the neighbor's new size from the *full requested* delta - handing the neighbor space the dragged row never actually gave up. This both violated the "the border only moves, total size stays constant" invariant from `table-resize-whole-table-instead-of-border.md` (the freed-up space came from nowhere - the table's total height silently grew) and, from the user's perspective, made it look like only the row below was ever affected, since the row actually being dragged visibly never moved.

## Fix

Replaced the row branch of `resolveSizes` with a DOM-measurement-based approach instead of pure arithmetic: whichever side is shrinking (the dragged row when moving up, the neighbor when moving down) has its `style.height` set to the requested target, then its *real, rendered* height is measured back via `getBoundingClientRect()` - this reflects whatever floor the browser actually enforced, whether that's the requested value or the content's natural minimum. The other (growing) side's new size is computed from that *actual* measured delta, not the originally-requested one - `actualSize + (nextStartSize - (actualSize - startSize)) === startSize + nextStartSize` always holds, so the constant-sum invariant is preserved exactly regardless of where a row's real floor turns out to be, including the "nothing happened, floor already reached" case where the growing side correctly doesn't move either. Column resize is unchanged - `table-layout: fixed` doesn't have this floor problem, matching the user's own confirmation that horizontal resize already worked correctly.

The same `resolveSizes` function is used for both the live drag preview (`handleMove`) and the final commit (`handleUp`), so the committed model value and what was visually shown during the drag never diverge (no snap-on-release).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`:
- "dragging a row boundary up does not grow the row below when the row above has no room to shrink" (new): reproduces the exact reported scenario on a freshly-inserted table - drags a row boundary up and asserts neither row's rendered height changes, both mid-drag and after release. Confirmed this fails deterministically (all 3 browsers, ~25px error) with the fix reverted.
- "resizing an internal row boundary redistributes with the adjacent row..." and "row resize handle tracks the live row border during the drag..." (both pre-existing, from `table-resize-whole-table-instead-of-border.md` and `table-row-resize-handle-lags-during-drag.md`): their fixture rows' starting height bumped from 60px to 150px, since their drag amounts (25px/40px) landed inside the ~55px natural content floor for a single-short-word cell once the fix made the code honest about that floor - the previous 60px starting height let the old, incorrect arithmetic silently produce numbers that could never actually render. Re-verified stable (3 runs × 3 browsers, 144/144 passed) alongside the new test and the merge-content-mixing fix.

## Related/similar issues

[table-resize-whole-table-instead-of-border](table-resize-whole-table-instead-of-border.md) - the design (redistribute between neighbors, keep total size constant) this fix makes actually hold true under a real-world content-floor constraint it didn't originally account for.
[table-row-resize-handle-lags-during-drag](table-row-resize-handle-lags-during-drag.md) - the same component, a different (already-fixed) mechanism (the handle's own on-screen position going stale, not the redistribution math itself).
