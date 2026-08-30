# Opening a toolbar dropdown moved focus off the editor, dropping the live selection

**Status:** Fixed (2026-08-29, found and fixed during the Direction B toolbar redesign implementation)
**Area:** toolbar / accessibility / react
**First reported:** Not user-reported — found while writing e2e coverage for the newly-introduced toolbar dropdowns (`ToolbarDropdown`/`MobileMoreMenu`, Direction B toolbar redesign).
**Related files:** `packages/react/src/components/ToolbarPrimitives.tsx` (`ToolbarDropdown`, `MobileMoreMenu`)

## Symptom

Every existing toolbar button (`ToolbarButton`, `ToolbarMenuItem`) has `onMouseDown={(event) => event.preventDefault()}` specifically so that clicking it never steals focus (and therefore never collapses the live text selection) away from the contenteditable surface — this is why, e.g., clicking "Bold" with text selected applies bold to that exact selection instead of losing it. The new `<details>/<summary>` dropdown triggers introduced by the Direction B redesign (`ToolbarDropdown`, `MobileMoreMenu`) did **not** carry the same guard. Clicking a `<summary>` element natively focuses it, so opening any dropdown ("More text styles", "Review", the mobile overflow menu, etc.) moved focus off the editor and cleared the selection before the user ever reached the tool inside.

Caught concretely by `e2e/suggestions.spec.ts`'s "ambient track-changes mode: normal typing and Backspace become live suggestions..." test: after moving "Track changes" into the Review dropdown (renamed "Show edits"), opening the dropdown to toggle it, then typing immediately afterward, the typed characters never appeared in the editor at all — because focus was still on the `<summary>`, not the contenteditable.

## Reproduction

1. Select some text in the editor.
2. Click a toolbar dropdown trigger (e.g. "More text styles").
3. The document's selection collapses/clears before any menu item is clicked, because focus moved to the `<summary>`.

This would have broken every real "apply to selection" flow (text colour, background colour, font size/family) that got moved behind a dropdown in this redesign, not just the test that happened to catch it.

## Root cause

`ToolbarDropdown`'s and `MobileMoreMenu`'s `<summary>` elements had no `onMouseDown` handler. Native browsers focus a `<summary>` on click as part of `<details>` toggling; nothing prevented that default.

## Fix

Added `onMouseDown={(event) => event.preventDefault()}` to both `<summary>` elements (`ToolbarDropdown` and `MobileMoreMenu` in `ToolbarPrimitives.tsx`), matching the exact convention every other toolbar control already used. The `<details>` element still opens/closes correctly on click (that's driven by the browser's default click, not mousedown, toggle behavior) — only the focus-stealing side effect is suppressed.

## Regression coverage

`e2e/suggestions.spec.ts`'s "ambient track-changes mode: normal typing and Backspace become live suggestions while enabled, and stop when disabled" test exercises exactly this path (open the Review dropdown, toggle Show edits, then type) and would fail again if this regressed. No dedicated "dropdown open preserves selection" test was added beyond this; a more direct regression test (select text, open a dropdown, apply a mark, assert it landed on the original selection) would be a reasonable follow-up.

## Related/similar issues

None yet — first instance of this specific focus-management gap, introduced by this phase's own new dropdown pattern rather than a pre-existing one.
