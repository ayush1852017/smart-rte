# Mobile "More tools" kebab menu clipped by a host's overflow:hidden, and never included the List preset control

**Status:** Fixed
**Area:** react / theme.ts (CSS) + ToolbarPrimitives.tsx + CanonicalAuthorityEditor.tsx
**First reported:** 2026-09-02, two screenshots: (1) a real Sootr small-screen layout where clicking the "..." kebab button opens nothing visible, (2) a second screenshot from a wider view showing the kebab menu's actual contents (Move block up/down, Indent/Outdent block, Check selected items, Indent/Outdent list item, Move item up/down, Restart/Continue numbering, Remove link) with no way to switch to numbered-list sub-styles (alpha/roman/outline) - only plain Bulleted/Numbered/Checklist toggles, plus a reference screenshot of the desired "1. 2. 3. / a. b. c. / A. B. C. / i. ii. iii. / I. II. III." style picker.
**Related files:** `docs/bugs/toolbar-dropdown-clipped-by-host-overflow-hidden.md` (the closely related prior fix this one was incorrectly assumed to already cover), `docs/bugs/list-preset-discoverability-ux-not-a-bug.md` (confirms the desktop "List preset" control's existence and intended purpose)

## Investigation

Two independent, unrelated gaps, both confirmed live before fixing:

**1. Kebab menu clipped.** `MobileMoreMenu` (`ToolbarPrimitives.tsx`) renders its panel as plain `position: absolute` with CSS `right: 0` (relative to its own `<details>` trigger). When the earlier `toolbar-dropdown-clipped-by-host-overflow-hidden.md` fix converted `ToolbarDropdown`'s own menu to `position: fixed`, that fix's own write-up explicitly stated `MobileMoreMenu` was "unaffected" and left untouched - an assumption never independently verified, and wrong. Reproduced directly: wrapped the editor in an `overflow: hidden` host at a 375px viewport (mirroring Sootr's real narrow-screen wrapper) and opened the kebab menu - its computed position was `left: -214px`, `position: absolute` - the vast majority of the panel rendered off-screen to the left, clipped by the host, functionally invisible despite being present in the DOM. This is the **only** overflow affordance on narrow viewports at all (every `ToolbarDropdown` hides entirely below the 639px breakpoint), making this actually more exposed to the bug than the dropdown case the original fix covered, not less.

**2. List preset missing from the mobile menu.** `packages/react/src/components/CanonicalAuthorityEditor.tsx`'s `<select aria-label="List preset">` (confirmed real and already correctly functional per `list-preset-discoverability-ux-not-a-bug.md` - decimal/lower-alpha/upper-alpha/roman/outline numbering styles, plus several bullet-glyph presets) was hardcoded only inside the desktop-only "More list tools" `ToolbarDropdown`. `MobileMoreMenu`'s children list included `listToolsMenuItems` (the item-level actions: indent/outdent/move/restart numbering) but never this `<select>` - confirmed via direct grep, this control had never been duplicated into the mobile menu at all, unlike every other desktop-dropdown-exclusive control in this system (e.g. the `widePromote` pattern for toolbar buttons). On a narrow viewport, a user genuinely had no way to reach anything beyond plain bulleted/numbered/checklist - matching the report exactly ("How to use other list types then number and bullet?").

## Fix

**1. `MobileMoreMenu`** now measures its own placement the same way `ToolbarDropdown` already does: a `useLayoutEffect` computing `left`/`top` from the trigger's `getBoundingClientRect()`, right-aligned to the trigger (matching the menu's original `right: 0` visual intent) and clamped into the viewport, applied via inline style plus `data-srte-menu-fixed="true"` (the same attribute/CSS rule `ToolbarDropdown` already established, `position: fixed; top: 0; left: 0;`, overridden per-instance by the inline `left`/`top`). `theme.ts`'s mobile-specific `.srte-mobile-more .srte-menu` rule had its now-dead `left: auto; right: 0;` removed (inline style always wins over any external rule regardless of specificity/order) while keeping its sizing/scroll properties (`width`, `max-height`, `overflow-y`, etc.) untouched.

**2. The `<select>`** was extracted into a shared `listPresetSelect` JSX variable (alongside the pre-existing `listToolsMenuItems` pattern) and rendered in **both** the desktop `ToolbarDropdown` (unchanged position/behavior) and `MobileMoreMenu` (new), immediately before `{listToolsMenuItems}` in each.

## Regression coverage

New `test.describe("mobile 'More tools' kebab menu: not clipped by a host's overflow:hidden, and includes the List preset control", ...)` in `canonical-toolbar-routing.spec.ts`:
- Wraps the editor in an `overflow: hidden` host at a 375px viewport (mirroring the real report), opens the kebab, asserts `position: fixed` and that the menu's bounding box stays fully within `[0, 375]` horizontally - then clicks a real item ("Move block down") and confirms the menu actually closes, proving the click genuinely landed rather than being silently swallowed by a clipped/obscured element.
- Confirms the mobile-menu's own `select[aria-label='List preset']` is visible, applies "ordered-upper-alpha" through it, and verifies the resulting list node's `attrs.preset` in the real model - not just that the control renders.

Both pass on all 3 engines. Existing tests using `getByRole("combobox", { name: "List preset" })` (now matching two DOM elements - desktop and mobile copies) continue to resolve correctly at every tested viewport, since Playwright's role-based queries exclude `display: none` elements from the accessibility tree the same way a screen reader would - verified by re-running the full existing list-preset test suite (`canonical-toolbar-routing.spec.ts`'s own list-preset routing test, `canonical-authority.spec.ts`'s "applies every exposed list preset" and "updates nested markers" tests, plus the full wide-viewport-promotion and container-width test suites) with zero new failures.

Suite counts after this fix: full verification in progress at time of writing (core untouched, react lint clean, full 3-browser e2e run pending final tally).

## Related/similar issues

`toolbar-dropdown-clipped-by-host-overflow-hidden.md` (the near-identical prior fix, whose own "MobileMoreMenu is unaffected" claim this report disproves - both are now fixed with the same pattern). `list-preset-discoverability-ux-not-a-bug.md` (confirms the desktop control's own correct behavior, unchanged by this fix - only its *reach* on mobile changed).
