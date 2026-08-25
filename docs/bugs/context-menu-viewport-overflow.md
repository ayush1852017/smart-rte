# Context menu overflowed near viewport edges instead of repositioning, and had no scroll for tall menus

**Status:** Fixed
**Area:** react / ContextMenu.tsx / positioning
**First reported:** 2026-08-19, post-Phase-11.5 manual testing (screenshot showing the menu opened near the right edge of the viewport, overflowing).
**Related files:** `packages/react/src/components/ContextMenu.tsx`.

## Symptom

Opening the context menu near the right edge of the viewport let it overflow off-screen instead of repositioning to stay visible. Separately, a menu with more items than fit the available height had no way to see the items past the bottom edge.

## Reproduction

Confirmed via a synthetic `contextmenu` DOM event dispatched at explicit coordinates (right at the viewport's own edges) rather than a real mouse click, so the exact pixel under test isn't at the mercy of what content happens to render there on a given run: right-clicking near the right edge, the bottom edge, and the bottom-right corner all overflowed before the fix; a menu with more items than the viewport height had no scroll.

## Root cause

`ContextMenu.tsx`'s positioning used a **hardcoded size estimate** (`menuWidth = 220`, `menuHeight = items.length * 34 + 12`) to clamp `left`/`top` against the viewport, instead of the menu's real rendered size. The container had no explicit `width` (only `minWidth: 200`), so any item label wider than ~220px (e.g. "Insert column right") made the *actual* rendered width exceed the assumed one - the clamp math, computed against the wrong number, let the real menu overflow anyway. The clamp also only ever *slid* the menu within `[8, viewport - assumedSize - 8]`; it never flipped to the opposite side, so a menu positioned near an edge with an incorrect size assumption had nowhere else to go. There was also no `maxHeight`/`overflowY` at all, so a menu taller than the remaining viewport space extended straight past it with no way to reach the rest of the items.

## Fix

Replaced the estimate-based single-pass clamp with a real two-pass measure: the menu first renders at the raw click point with `visibility: hidden` (not unrendered, so `getBoundingClientRect()` has real content to measure), a `useLayoutEffect` measures the actual width/height, then computes a final position - flipping left (menu's right edge at the click point) when the default rightward open would overflow, and flipping up the same way for the bottom edge - and only then makes the menu visible at that corrected position. Also added `maxHeight` (the space actually remaining below wherever the menu ends up opening) and `overflowY: auto`, so a menu taller than that scrolls internally instead of extending off-screen.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`:
- "keeps the context menu fully within the viewport at every edge, and scrolls when taller than available space" - right edge, bottom edge, and bottom-right corner, each asserting the menu's full bounding box stays within `[0, viewport dimension]`.
- "scrolls the context menu internally instead of overflowing when it's taller than the viewport" - a short (350px) viewport, asserting the menu's rendered box stays within bounds and `scrollHeight > clientHeight` (the scroll actually engages, not just that overflow is visually hidden).

## Related/similar issues

[context-menu-outside-click-dismiss-untested](context-menu-outside-click-dismiss-untested.md), [context-menu-not-scoped-to-click-target](context-menu-not-scoped-to-click-target.md) - investigated in the same batch, different mechanisms (dismiss listener, scope resolution) in the same component family.
