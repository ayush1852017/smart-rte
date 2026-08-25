# Row resize handle's blue line lagged behind the real border, appearing misplaced/overflowing; column resize was unaffected

**Status:** Fixed
**Area:** react / TableResizeHandles.tsx
**First reported:** 2026-08-20, "that blue line shows up when we vertically resize is showing overflowed bottom side out of the table and editor both. Resize vertically is not working same as it behaves horizantaly. Also, that blue line and actual border during resize are misplaced. blue line is veryslow."
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`.

## Symptom

Dragging a row resize handle moved the actual row border live (the row itself visibly grew/shrank during the drag, matching the live-preview design from `table-resize-whole-table-instead-of-border.md`), but the blue drag-handle overlay itself stayed frozen near its pre-drag position, appearing to lag far behind the real border ("very slow"), be positioned somewhere else entirely ("misplaced"), and - since it's a `position: fixed` element independent of any container's clipping - visibly sit past the bottom edge of the table and the editor once the row had grown enough ("overflowed bottom side out of the table and editor both"). Column (horizontal) resize did not show this problem.

## Reproduction

Confirmed directly: forced this exact scenario with the fix temporarily reverted (commented out the one new `recompute()` call) and ran the new regression test below across all 3 browsers - WebKit failed deterministically (handle 25px off from the real border mid-drag, tolerance was 4px), confirming the bug is real and this specific code path is the cause. Chromium/Firefox happened to pass in that same reverted run (see Root cause for why), matching why this was easy to miss with light manual testing but still visibly wrong to the reporter.

## Root cause

`TableResizeHandles.tsx` renders each handle at a `position`/`start`/`length` taken from React state (`columns`/`rows`), which is only ever recomputed by a `ResizeObserver` watching the `<table>` element's own box size (plus a `MutationObserver` for structural changes, and a scroll listener) - never during the drag itself. The live-preview drag loop (`handleMove`) mutates a row's `style.height` directly, which is what makes the real border move smoothly, but that mutation alone doesn't touch the handle's own rendered position.

For an *internal* row-boundary drag, `resolveSizes` deliberately keeps `startSize + nextStartSize` constant (the "border only moves, table doesn't resize" design from `table-resize-whole-table-instead-of-border.md`) - meaning the table's own total height never changes during the drag, so the `ResizeObserver` watching the table's box size never fires, and the row handle's position state is never refreshed until the drag ends and a real render happens.

Column resize has the same architecture and the same theoretical gap, but `table-layout: fixed` redistributes column widths with sub-pixel rounding, which incidentally nudges the table's own rendered width by a fraction of a pixel during most drags - just enough to retrigger the `ResizeObserver` and keep the column handle looking like it tracks live, even though nothing in the code guarantees that. Row heights have no equivalent browser-side rounding/redistribution, so the table's total height stays *exactly* constant and the observer reliably never fires - which is also consistent with the "reverted fix" test above passing by accident in Chromium/Firefox (observer timing/rounding differences between engines) while failing deterministically in WebKit.

## Fix

Extracted the existing `recompute()` logic (reads live `getBoundingClientRect()` for every column/row) out of the `ResizeObserver` effect into a shared, `useCallback`-memoized function, and call it directly at the end of `handleMove`, right after the live-preview style mutations. A `getBoundingClientRect()` read immediately after a style write forces the browser to flush layout first, so this always reflects the mutation that was just made - keeping both row and column handles tracking the real border on every `pointermove`, independent of whether (or when) `ResizeObserver` happens to fire. The passive observers (`ResizeObserver`/`MutationObserver`/scroll) are unchanged and still needed for layout/structural changes that happen outside an active drag.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "row resize handle tracks the live row border during the drag, not just after release": drags an internal row boundary, and *before* releasing the pointer, asserts the handle's own bounding box center is within 4px of the actual row border's live position. Confirmed this fails (WebKit, 25px off) with the fix reverted and passes with it applied, across all 3 browsers, 3 repeated runs.

## Related/similar issues

- [table-resize-whole-table-instead-of-border](table-resize-whole-table-instead-of-border.md) - the design (redistribute-between-neighbors, keep total size constant) whose own invariant is what made the `ResizeObserver` stop firing for internal row drags; that fix's own behavior is unchanged here.
- [table-resize-handles-stale-after-structural-change](table-resize-handles-stale-after-structural-change.md) - the same component, a different (already-fixed) staleness mechanism (structural edits outside a drag, not live position during one).
- [table-resize-handles-all-highlight-together](table-resize-handles-all-highlight-together.md) - the same component, a different (already-fixed) bug (which handle highlights, not where it's positioned).
