# Context menu's max height scaled with click position instead of being fixed

**Status:** Fixed
**Area:** react / ContextMenu.tsx
**First reported:** 2026-08-20 ("context menu dialog should have scroll. Height should be fixed.")
**Related files:** `packages/react/src/components/ContextMenu.tsx`.

## Symptom

The context menu's scroll threshold felt inconsistent - a right-click near the top of the viewport got a very tall menu before scrolling kicked in, while one near the bottom got a short one.

## Reproduction

`docs/bugs/context-menu-viewport-overflow.md` (the previous round) added a `maxHeight` computed as "whatever space remains below wherever the menu opens" - correct for never overflowing the viewport, but it meant the scroll threshold moved depending on click position, not a fixed value. This became more noticeable once the menu's own item count grew (cell colour, media edit/resize added the same round) - a click near the top of a tall viewport could show 15+ items with no scroll at all, while the same click near the bottom would scroll after far fewer.

## Fix

Added a fixed `MAX_MENU_HEIGHT` (400px) cap; the actual `maxHeight` is `Math.min(MAX_MENU_HEIGHT, availableViewportSpace)` - still never overflows a genuinely short viewport, but no longer grows unbounded just because there happened to be room.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "caps the context menu at a fixed height and scrolls even with plenty of viewport room": right-clicks a link inside a table cell at the default (1280x720) viewport - more than 10 items resolve, well within the viewport's available space - and asserts the menu's rendered height stays at or under the fixed cap with `scrollHeight > clientHeight` (scroll actually engages), not just that it happens to fit.

## Related/similar issues

[context-menu-viewport-overflow](context-menu-viewport-overflow.md) - the fix this refines; both about the same `maxHeight` calculation in the same component.
