# Toolbar menus/popovers land far from their trigger when the editor is embedded inside a transformed ancestor (e.g. a centered dialog)

**Status:** Fixed
**Area:** react / `ToolbarPrimitives.tsx`, `ColorPickerPopover.tsx`, `TableBorderPopover.tsx` (new shared `fixedPositioning.ts`)
**First reported:** 2026-09-02, screenshot from real Sootr usage: the "..." kebab menu opened, but the dropdown panel rendered far to the right of, and disconnected from, its own trigger button, near the far-right edge of the browser window.
**Related files:** `docs/bugs/mobile-more-menu-clipped-and-missing-list-preset.md` and `docs/bugs/toolbar-dropdown-clipped-by-host-overflow-hidden.md` (the prior `position: absolute` → `position: fixed` fixes this bug builds on and partially disproves - both left an explicit "barring an ancestor with its own transform" caveat in their own doc comments that turned out to matter in practice).

## Investigation

Confirmed Sootr was running the very latest published `smartrte-react` (`1.0.0-beta.8`, including both prior `position: fixed` fixes), so this was either a new regression or a gap in that fix, not a stale-version artifact.

Sootr renders `RichTextEditor` inside `MCQFormDialog`/`PYEQFormDialog` (`shadcn`/Radix `Dialog`), whose `DialogContent` (`components/ui/dialog.tsx`) carries Tailwind's own dialog-centering classes: `fixed top-[50%] left-[50%] ... translate-x-[-50%] translate-y-[-50%]`. A CSS `transform` on an ancestor makes that ancestor the containing block for `position: fixed` descendants **instead of the viewport** (CSS Transforms spec) - the same caveat already called out, but never actually handled, in both `ToolbarDropdown`'s and `MobileMoreMenu`'s own doc comments ("barring an ancestor with its own transform/filter, not the case here").

Every JS-measured `position: fixed` overlay in this codebase (`ToolbarDropdown`, `MobileMoreMenu`, `ColorPickerPopover`, `TableBorderPopover`) computes `left`/`top` from `getBoundingClientRect()`, which always returns **viewport-relative** coordinates regardless of transforms. When the actual containing block is a transformed ancestor instead of the viewport, those coordinates get interpreted relative to that ancestor's border box, not the viewport - internally consistent, but visibly wrong, with no error anywhere. Confirmed directly: none of the four components used a portal, and all four had the identical vulnerability, not just the one that was reported.

## Fix

New shared `packages/react/src/components/fixedPositioning.ts`: `findFixedPositioningContainer(el)` walks up from `el` looking for the nearest ancestor with a non-`none` `transform`/`perspective`/`filter`/`backdrop-filter`, or a `will-change` naming one of those (any of these creates a new containing block for `position: fixed` descendants). `getFixedPositioningOrigin(el)` returns that ancestor's `getBoundingClientRect()` top-left (or `{0, 0}` if none exists - the ordinary viewport case).

Every placement calculation now subtracts this origin before writing the `left`/`top` inline styles, so the visual result is correct whether the real containing block is the viewport or a transformed ancestor - `ToolbarDropdown`, `MobileMoreMenu`, `ColorPickerPopover`, and `TableBorderPopover` all updated identically. `ToolbarDropdown`'s doc comment (which incorrectly asserted this case doesn't happen) was corrected to point at this fix instead.

## Regression coverage

New `test.describe("toolbar overlays: correctly positioned inside a transformed ancestor (e.g. a host's centering dialog)", ...)` in `canonical-toolbar-routing.spec.ts`, wrapping the editor in a synthetic host mirroring Radix's own dialog-centering CSS (`position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)`):
- A desktop `ToolbarDropdown` ("More text styles") lands adjacent to its own trigger and its item remains genuinely clickable.
- The mobile "More tools" kebab menu lands adjacent to its own trigger and its item remains genuinely clickable.
- The text-colour `ColorPickerPopover` lands adjacent to the menu item that opened it.

Verified all three tests genuinely fail without the fix (reverted the four source changes, rebuilt, reran - dropdown off by 290px, mobile menu off by 472px, colour popover off by 290px) and pass with it, across all 3 engines. Full existing unit suite (151/151) passes. Full e2e suite (585 tests × 3 engines): 568 passed, 10 failed - all 10 are pre-existing and unrelated (table-resize drag timing, a firefox browser-context-creation timeout, and two `partial-cross-paragraph-delete.spec.ts` firefox failures confirmed to reproduce identically with this fix's four source files fully reverted). None of the new or existing toolbar-overlay-positioning tests are among the 10.

## Related/similar issues

`toolbar-dropdown-clipped-by-host-overflow-hidden.md` and `mobile-more-menu-clipped-and-missing-list-preset.md` (the prior `position: absolute` → `position: fixed` fixes this one builds directly on top of, and whose own "not the case here" transform caveat this report disproves).
