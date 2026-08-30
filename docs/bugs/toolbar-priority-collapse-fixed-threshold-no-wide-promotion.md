# Toolbar priority-collapse doesn't scale up on wide viewports - important tools stayed dropdown-only even at ~2264px

**Status:** Fixed
**Area:** toolbar / react
**First reported:** 2026-08-30, "Codex prompt — toolbar priority-collapse doesn't scale up on wide viewports" (screenshot at ~2264px)
**Related files:** `toolbar-dropdown-no-outside-click-dismiss.md`, `toolbar-dropdown-summary-steals-editor-focus.md` (other Direction B toolbar-mechanism gaps found this session)

## Symptom

On a genuinely spacious desktop viewport (~2264px, per the report), several tools stayed buried inside dropdowns instead of being shown directly: Superscript, Subscript, Text colour, Background colour, Font size, Font family (all inside "More text styles"), and Remove link, Insert formula, Special characters (all inside "More to insert").

## Investigation

Per the report's own framing, this could have been (a) a fixed collapse threshold that should scale with width, (b) mis-tuned per-tool priority values, or both. Traced the actual mechanism (`packages/react/src/theme.ts`, `ToolbarPrimitives.tsx`, the toolbar JSX in `CanonicalAuthorityEditor.tsx`):

- **Only one breakpoint exists at all**: `theme.ts` had exactly one collapse threshold, `(max-width: 639px)` (duplicated as both a plain `@media` query and an `@container srte-editor` query, the latter tracking the actual rendered width of the editor's own root element rather than the browser viewport). Above 639px, nothing in CSS or JS ever changes again, regardless of whether the viewport is 640px or 6000px - confirmed no `ResizeObserver`/width-measuring JS collapse logic exists anywhere in the package (grepped for `ResizeObserver`/`offsetWidth`/`clientWidth`/`@container` across `packages/react/src`; every `ResizeObserver` usage found is for unrelated live-element-anchoring, e.g. `MediaOverlay.tsx`, `TableResizeHandles.tsx`).
- **Every dropdown uses the identical priority value**: all 7 `<ToolbarDropdown priority={2}>` instances in `CanonicalAuthorityEditor.tsx` use the same `priority={2}` - there is no finer-grained tiering among them. `ToolbarGroup`'s own `priority={3}` mechanism (meant to hide a whole group, per `theme.ts`'s `.srte-toolbar-group[data-srte-priority="3"]` rule) is never actually applied to any `<ToolbarGroup>` in the JSX - dead, unused code.
- **The toolbar already `flex-wrap`s** (`.srte-toolbar { display:flex; flex-wrap:wrap; ...}`), so it never structurally "runs out of room" the way a non-wrapping toolbar would - extra tools just wrap to a second row rather than triggering any overflow logic. This means which tools are "always visible" vs. "in a dropdown" was purely a static, build-time JSX authoring decision (Direction B's original grouping), never something that responded to available width at all.

**Conclusion**: this is case (a), a fixed threshold, and there was nothing to "re-tune" on axis (b) since only one priority value was ever used - the mechanism simply never had a wide-viewport tier to tune in the first place.

## Fix

Extended the same CSS-driven, duplicate-content-toggle-visibility architecture this system already uses for its mobile tier (`MobileMoreMenu` statically duplicates every dropdown's contents; see `ToolbarPrimitives.tsx`'s own doc comment), rather than introducing a different JS-measured architecture:

- `ToolbarButton`/`ToolbarMenuItem` (`ToolbarPrimitives.tsx`) both gained an optional `widePromote` prop, setting `data-srte-wide-promote="true"`.
- The 9 named tools' existing `<ToolbarMenuItem>` (dropdown/mobile-menu) entries in `CanonicalAuthorityEditor.tsx` got `widePromote`, and each also got a new standalone `<ToolbarButton widePromote>` copy rendered directly in the main toolbar row (in the same `ToolbarGroup` as their thematic siblings - Superscript etc. next to Bold/Italic/Underline/Strikethrough; Remove link/Insert formula/Special characters next to Link/Image).
- `theme.ts`: new breakpoint (both `@media (min-width: 1440px)` and the matching `@container srte-editor` form) - below it, `.srte-tool-button[data-srte-wide-promote="true"] { display:none }` (the standalone copy is hidden, dropdown copy is what's reachable, i.e. today's unchanged behavior); at/above it, the standalone copy shows and `.srte-menu-item[data-srte-wide-promote="true"] { display:none }` hides the now-redundant dropdown/mobile-menu copy.
- **1440px, not 1280px**: Playwright's own default test viewport is exactly 1280×720, and the overwhelming majority of this suite's toolbar tests run at that default without ever calling `setViewportSize`. A 1280px threshold would have flipped nearly every existing `role="menuitem"` toolbar locator in the suite over to `display:none` out from under it. 1440px clears that default with margin while still comfortably covering the ~2264px "wide desktop" width the report was filed against.
- "Code" (the remaining item in "More text styles") and Insert video/audio + the selected-media actions (remaining in "More to insert") were deliberately **not** promoted - the report's own named list didn't include them, and promoting everything would have emptied those dropdowns rather than just lightening them.

This is a 3-tier system now: `<640px` mobile (single "More tools" menu, unchanged), `640–1439px` compact/grouped-dropdown (today's unchanged layout - covers both tablet and typical laptop widths), `≥1440px` wide (the 9 tools promoted to always-visible buttons).

## Verification

Real-browser Playwright checks (not just CSS/unit assertions) at four viewport widths, all three browser engines:
- **Mobile (375×800)**: promoted tools not directly visible; reachable via the single "More tools" menu (unchanged).
- **Tablet (800×900)**: promoted tools stay inside their dropdowns (unchanged).
- **Typical laptop (1280×800 - also Playwright's own default)**: promoted tools stay inside their dropdowns, confirming the 1440px threshold choice doesn't accidentally trigger at the suite's default viewport.
- **Wide desktop (2264×1200, the reported width)**: all 9 tools directly visible as top-level buttons; the "More text styles" dropdown still exists (for "Code") but no longer lists Superscript; a promoted button (Superscript) was clicked end-to-end and confirmed to actually apply the mark, not just render.

Suite counts after the fix: core 721/721, react 132/132, `pnpm run lint` clean, full 3-browser Playwright e2e suite 500/510 passed (the 10 non-passes are 7 pre-existing skips plus 3 already-documented, unrelated flakes - see Related/similar issues below; confirmed via `git stash` isolating this change that the flakes reproduce identically without it).

## Regression coverage

New `test.describe("toolbar priority-collapse: wide-viewport promotion", ...)` in `packages/react/e2e/canonical-toolbar-routing.spec.ts` - 4 tests × 3 browsers, described above. No pre-existing responsive-collapse test existed for this system at all (confirmed via search for `setViewportSize`/`639`/`1280`/priority-related assertions across `packages/react/e2e/` - the only prior `setViewportSize` usage in the suite is unrelated, for a context-menu viewport-overflow test), so this is new coverage, not an update to an existing spec.

## Related/similar issues

`toolbar-dropdown-no-outside-click-dismiss.md`, `toolbar-dropdown-summary-steals-editor-focus.md` - other gaps found in the same Direction B dropdown mechanism this session. `media-overlay-no-drag-resizer.md`'s addendum documents an unrelated pre-existing Firefox-only flake noticed during this fix's verification (a drag-corner-handle resize test), confirmed via `git stash` to be present with or without this change.
