# Toolbar dropdowns didn't close on click into the editor — native `<details>` doesn't auto-dismiss

**Status:** Fixed (2026-08-29)
**Area:** react / ToolbarPrimitives.tsx (`ToolbarDropdown`, `MobileMoreMenu`)
**First reported:** "Currently a dropdown left open and then clicking into the editor content doesn't close it."
**Related files:** `packages/react/src/components/ToolbarPrimitives.tsx`.

## Symptom

Opening any Direction B toolbar dropdown ("More text styles", "Table tools", the mobile overflow menu, etc.) and then clicking into the editor to continue typing left the dropdown open, overlapping the document.

## Reproduction

Confirmed directly (not assumed from the symptom): `ToolbarDropdown`'s own doc comment claimed "`<details>` already closes on an outside click by default in every evergreen browser" - false. A minimal Playwright check (open the dropdown via its `<summary>`, click into the editor, read the `<details>` element's `open` attribute) showed it stayed open. Native `<details>` only closes via its own `<summary>` toggle or a script explicitly clearing `open` - there is no browser-native "outside click closes it" behavior, unlike a real modal/popover.

## Root cause

An incorrect assumption baked into the component's own doc comment when it was first written, never verified against real behavior.

## Fix

Added `useDismissDetailsOnOutsideClick(ref)` to `ToolbarPrimitives.tsx` - the exact same pattern already proven in `ContextMenu.tsx` and `ColorPickerPopover.tsx` (`docs/bugs/context-menu-outside-click-dismiss-untested.md`, `docs/bugs/color-picker-no-current-color-no-outside-dismiss.md`): a `window`-level `pointerdown`+`mousedown` capture-phase listener that closes the `<details>` (`removeAttribute("open")`) when the click target is outside it and it's currently open. Applied to both `ToolbarDropdown` and `MobileMoreMenu`. A side benefit confirmed during verification: opening a second dropdown while a first is open now also correctly closes the first (its own trigger click is "outside" the first dropdown), matching normal single-menu-open UX, without any extra code.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` - new: "an open toolbar dropdown closes when clicking into the editor" - opens "More text styles", confirms a menu item is visible, clicks into the editor, asserts the dropdown's `open` attribute is gone and the menu item is no longer visible. Full toolbar/comments/suggestions e2e subset (22 tests) re-run clean, confirming clicking a menu item to actually use a tool (which already closes its own dropdown via `ToolbarMenuItem`'s existing logic) is unaffected.

## Related/similar issues

[context-menu-outside-click-dismiss-untested](context-menu-outside-click-dismiss-untested.md), [color-picker-no-current-color-no-outside-dismiss](color-picker-no-current-color-no-outside-dismiss.md) - the two prior instances of this exact pattern, reused here directly.
