# Color popover closed the instant the native color-picker input was touched

**Status:** Fixed
**Area:** react / ColorPickerPopover.tsx
**First reported:** 2026-08-20, immediately after the native `<input type="color">` was added ("color picker window goes away as soon as I click on it. How I suppose to pick color.").
**Related files:** `packages/react/src/components/ColorPickerPopover.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`applyColor`).

## Symptom

Opening the color popover and clicking the native color-picker swatch closed the entire popover immediately, before a color could actually be chosen.

## Reproduction

Confirmed by inspecting the code that shipped the native `<input type="color">`: its `onChange` handler called `apply(event.target.value)` directly, and `apply()` calls `onApply`, which is `CanonicalAuthorityEditor.tsx`'s `applyColor` - which ends with `setColorPopover(null)`, unmounting the whole popover. Some browsers fire a native color input's `onChange` on the very first interaction with the picker (opening it, or an intermediate drag step within it), not only on a final, deliberate commit - auto-applying (and therefore auto-closing) on that first event closed the popover before the user could finish picking anything.

## Root cause

Conflating "the native input's value changed" with "the user is done picking a color." The swatch grid this popover previously had made the same call correctly for itself (a swatch click *is* a single, complete, deliberate choice), but a continuous picker like a native color input isn't a single discrete event the same way.

## Fix

The native input's `onChange` now only stages the value (`setHex`), the same way the hex text input already did - it no longer calls `apply()` directly. The existing explicit "Apply" button is the only thing that commits and closes the popover for a picker-driven choice, matching how the hex input already required a click on Apply (or Enter) rather than auto-applying on every keystroke.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "applies text color via the native picker and background color via a custom hex value" and "sets cell background and text colour via the right-click context menu" both now go through a `pickNativeColor` helper that drives the native input via its own event *and* an explicit Apply click, asserting the popover closes only after Apply - not on the native input's own event alone. (Updated when live preview was added - see below - to dispatch `input` rather than `change`, matching the event React's onChange actually maps to; the assertion this test protects, "only Apply commits," is unchanged.)

## Related/similar issues

- [color-preview-render-steals-focus-from-popover](color-preview-render-steals-focus-from-popover.md) - this exact invariant ("no native color-input event ever auto-commits") was re-threatened and had to be re-affirmed when live drag-preview was added on top of this fix - a `change`-triggers-commit design was tried first (to mirror `TableResizeHandles`' pointerup-commit pattern), reintroduced this bug's exact symptom, and was reverted in favor of keeping Apply/Enter as the only commit triggers, unchanged from this fix.
