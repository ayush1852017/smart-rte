# The Bulleted/Numbered list preset picker disappeared everywhere below 639px, not just where it actually needed to

**Status:** Fixed
**Area:** react - `theme.ts` (container-query breakpoints), `CanonicalAuthorityEditor.tsx`, `ToolbarPrimitives.tsx`
**First reported:** 2026-09-08 — "below 680px it's not showing dropdown icons at list tools?" (a live report, testing the split-control feature added earlier the same day)

## What happened

The split-control preset picker (`docs/bugs/list-preset-split-control-not-a-dropdown.md`) added a native `<select>` chevron next to the Bulleted list/Numbered list buttons. Verifying it didn't break the existing "no button should render narrower than its content" toolbar test, a real squeeze was found — but only measured at the test's own coarse sweep granularity (steps of 80px, starting at 340px). The fix committed at the time reused the **existing 639px mobile-tier breakpoint** to hide the select, since that was the nearest breakpoint already in the file and it made the failing test pass.

That breakpoint was far too broad. Re-bisecting at 10px granularity after the live report showed the squeeze only actually occurs at container widths of **340–349px** — a 10px sliver — and is completely clean at 350px and every width tested up to 700px. Reusing 639px hid the picker across the entire ~290px range above where it was actually needed, which is exactly the range a real embedding dialog (like the one in the live report) is likely to sit in.

## Fix

Replaced the 639px-reuse with a dedicated, tightly-scoped `@container srte-editor (max-width: 359px)` rule (349px measured floor + a 10px margin) that hides only the split-control select — nothing else in that block changes. The picker is now visible at every width from 360px up to and past the 639px mobile-tier breakpoint, matching what a "was this actually necessary" check should have caught the first time: **a fix should be re-measured at the granularity that matters, not accepted at whatever granularity happened to be available from an existing test.**

## Related, requested in the same follow-up

While fixing this, a second request landed in the same conversation: "Below 480px don't show tool name just show icon... for paragraph, bulleted, numbered, checklist." Implemented as a third, independent breakpoint (`max-width: 479px`, deliberately not reusing either of the other two thresholds, since this is a different concern with a different natural width):

- `ToolbarButton` gained a `narrowIconOnly` prop (`data-srte-narrow-icon-only="true"`) — unlike the existing `iconOnly` (always icon-only, e.g. the 4-way align cluster), this only drops the `<span>` label below 479px; `aria-label`/`title` are untouched at every width, so the tooltip and accessible name never disappear. Applied to Bulleted list, Numbered list, and Checklist only — Bold/Italic/etc. were not asked for and keep their labels at every width.
- The block-type ("Paragraph"/"Heading 1"/...) control is a native `<select>` — its visible text *is* the selected option's value, not a separate label node, so it can't be selectively hidden the same way. Gets the same treatment `.srte-split-control`'s own select already uses: `color: transparent` plus a background-image icon (the Pilcrow glyph, already defined in `toolbarIcons` as `paragraphStyle` but otherwise unused) standing in for the hidden text. The native option list is unaffected and still shows full text when opened.

**A real CSS specificity bug caught during this pass**: the block-type select's narrow-width rule was first written as a bare `.srte-block-type-select { color: transparent; ... }`. It silently had no effect — `.srte-toolbar select` (an existing, unrelated base rule) has higher specificity (class + type vs. just class) and its own `color: var(--srte-foreground)` won regardless of source order, so the select rendered a single stray glyph instead of the intended icon. Confirmed visually via screenshot before concluding it worked - a text-only check would have missed this, since `getComputedStyle` output alone wouldn't have shown *which* rule actually won without checking cascade order by hand. Fixed by raising specificity: `.srte-toolbar select.srte-block-type-select`.

## Regression coverage

`e2e/canonical-toolbar-routing.spec.ts`:
- Existing "continuous sweep, 340px–2300px" test — now passes with the split-control select visible everywhere above 359px, not just above 639px (previously it only incidentally passed because the select was hidden across that whole range).
- New test "block type, bulleted list, numbered list, and checklist drop their text label below 480px but keep their name and tooltip" — confirms labels render normally at 500px, confirms the label `<span>` becomes hidden (not removed) below 480px (checked via `toBeHidden()` on the span itself, not the button's `textContent` — a `display: none` span still contributes to `textContent`, so asserting `not.toContainText` on the button would have been a false test), confirms `title`/`aria-label` survive at the narrow width for all four controls, and confirms the button is still fully clickable/functional icon-only. Passed 3/3 browsers.
- Full `canonical-toolbar-routing.spec.ts`: 102/102 (3 browsers). Full `canonical-authority.spec.ts`: 360 passed / 8 skipped / 1 failed (a WebKit media-atom-resize-drag test, confirmed via 3x repeat-each in isolation to be the already-documented `webkit-full-suite-timeout-flake.md` class of resource-contention flake — 3/3 clean alone, unrelated to any change here).

## Related/similar issues

- [list-preset-split-control-not-a-dropdown](list-preset-split-control-not-a-dropdown.md) — introduced the squeeze and the over-broad first fix this entry corrects.
- [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) — the pre-existing flake class the one unrelated full-suite failure during verification matched.
