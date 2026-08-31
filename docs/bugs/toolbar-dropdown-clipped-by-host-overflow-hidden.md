# Toolbar dropdown menus clipped to invisible fragments by a host's own `overflow: hidden` container

**Status:** Fixed
**Area:** react / theme.ts + ToolbarPrimitives.tsx
**First reported:** 2026-08-31, alongside a separate scroll/height report ("minimize editor so few tools gets hidden and kebab dropdown is not completely visible" - screenshot showed dropdown items visible only as trailing fragments: "cript"/"pt"/"our"/"mily"/"ock up"/"ock down"). Filed after `toolbar-wide-promotion-fires-on-viewport-width-not-container-width.md`'s fix was already published (`1.0.0-beta.2`) and confirmed live in Sootr.
**Related files:** `packages/react/src/theme.ts`, `packages/react/src/components/ToolbarPrimitives.tsx`, `packages/react/e2e/canonical-toolbar-routing.spec.ts`, `packages/react/src/components/ColorPickerPopover.tsx` (the pre-existing, proven pattern this fix replicates)

## Investigation

The clipped-word fragments were the real giveaway: `"ock up"`/`"ock down"` are the tail ends of "Move block up"/"Move block down" (confirmed via direct inspection of "More paragraph tools"' actual menu items at a compact-tier width) - i.e., the *left* portion of each menu item's label was being cut off, not the whole menu missing.

`ToolbarDropdown`'s `.srte-menu` panel (`theme.ts`) was `position: absolute`, anchored to its own `.srte-toolbar-menu` (`position: relative`) trigger. Sootr's own `RichTextEditor.tsx` wraps the editor in `<div className="smartrte-container ... overflow-hidden ...">` for its own layout reasons (rounded corners, clipping a resizable split-pane panel). A `position: absolute` descendant's containing block is whichever ancestor establishes one - here, the `.smartrte-container` chain - so once the menu needed to extend past that container's own bounds (exactly the case in a narrow host), the container's `overflow: hidden` silently clipped it. Confirmed the mechanism directly and unambiguously with an isolated repro (a bare div/button/absolute-menu triple, no editor involved): with `position: absolute`, the menu was 100% invisible when its target position placed it entirely past a narrow `overflow:hidden` ancestor's edge; switching only its `position` to `fixed` (mirroring `ColorPickerPopover`'s existing pattern) made it render fully and correctly regardless of the ancestor.

**Why this wasn't caught by `toolbar-wide-promotion-fires-on-viewport-width-not-container-width.md`'s own new regression suite**: that fix's tests constrain the editor's *rendered width* but never wrap it in an `overflow: hidden` ancestor - they test the collapse/promotion *logic*, not the dropdown *panel's own positioning*, which is a structurally separate concern this report is the first to touch.

## Fix

`ToolbarDropdown` (`ToolbarPrimitives.tsx`) now measures its own trigger's `getBoundingClientRect()` on open (via a `toggle` event listener on the `<details>` element, since native `<details>`/`<summary>` is kept for its free keyboard/focus semantics - only the panel's positioning changed, not the disclosure mechanism), clamps into the viewport the same way `ColorPickerPopover` already does, and renders the panel with `position: fixed` and inline `left`/`top`. `theme.ts` gained `.srte-menu[data-srte-menu-fixed="true"] { position: fixed; top: 0; left: 0; }` (the inline style wins over these placeholder `0`s) - scoped to a new `data-srte-menu-fixed` attribute so `MobileMoreMenu`'s own overflow menu (which has its own separately-already-correct CSS positioning for the mobile tier, unaffected by this bug and untouched by this fix) keeps its existing behavior exactly as-is.

`position: fixed`'s containing block is the viewport (barring an ancestor with its own `transform`/`filter`/`perspective`/`will-change: transform`, not the case for Sootr's plain `overflow-hidden` wrapper), so it escapes ANY ancestor's overflow clipping regardless of DOM nesting depth - the same reason this exact pattern was already chosen for `ColorPickerPopover` and `TableBorderPopover`. `ToolbarDropdown` was the one remaining floating panel in this codebase still using the more fragile nested-`position:absolute` approach.

## Regression coverage

New `test.describe("toolbar dropdown menu: not clipped by a host's own overflow: hidden container", ...)` in `canonical-toolbar-routing.spec.ts`: wraps the editor in a `.smartrte-container`-style `overflow: hidden` host (mirroring Sootr's real wrapper exactly), opens "More paragraph tools" (the exact dropdown from the real report, confirmed via its items matching the reported clipped fragments), asserts the panel's computed `position` is `fixed`, then clicks a real menu item inside it and confirms the dropdown actually closes (`ToolbarMenuItem`'s own dismiss-on-action behavior) - proving the click genuinely landed on the item rather than being swallowed by an invisible/clipped element, which is the actual real-world impact of the bug (not just "wrong pixel," but genuinely unusable).

All 3 engines pass. Full `canonical-toolbar-routing.spec.ts` file: 72/72 (the one webkit failure seen in the same run, `routes lists, links, tables, atoms, resize, import, and export through retained state`, is an unrelated pre-existing image-load network flake - `data-smart-media-state="error"`, confirmed non-reproducing 2/3 times in isolation, nothing to do with dropdown positioning).

## Related/similar issues

`toolbar-wide-promotion-fires-on-viewport-width-not-container-width.md` (reported and fixed in the same session, a different bug in the same general "toolbar breaks in a real embedded host" family - that one was a collapse/promotion *logic* bug, this one a *panel positioning* bug). `ColorPickerPopover.tsx`/`TableBorderPopover.tsx` (the pre-existing pattern this fix brings `ToolbarDropdown` in line with).
