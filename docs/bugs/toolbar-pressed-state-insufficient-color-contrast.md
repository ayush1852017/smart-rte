# Pressed toolbar button text fails WCAG AA color contrast (4.43:1, needs 4.5:1)

**Status:** Fixed
**Area:** toolbar / theme / accessibility
**First reported:** 2026-08-19, found by an axe-core scan added while expanding a11y coverage from `canonical-surface.spec.ts` (the only file with any axe scans before this) to the real product surface (`canonical-authority.spec.ts`, `canonical-toolbar-routing.spec.ts`, `clipboard-workflows.spec.ts`) — Phase 11 Tier 3.
**Related files:** `packages/react/src/theme.ts` (`.srte-tool-button[aria-pressed="true"]`), `packages/react/e2e/canonical-authority.spec.ts`

## Symptom

Any toolbar button in its pressed/active state (e.g. "Check selected items" while a checklist item is checked, or any mark/list toggle button while active) rendered `color: var(--srte-primary)` (`#2563eb`) on `background: var(--srte-accent-bg)` (`rgba(2, 132, 199, 0.12)`, ≈ `#e1f0f8` over white) — a measured contrast ratio of 4.43:1, just under WCAG 2 AA's 4.5:1 minimum for normal-size text. `list-toggle-buttons-missing-aria-pressed.md` fixed a related but distinct bug (the `aria-pressed` attribute itself was missing on some buttons); this is about the pressed state's *visual* contrast, on a button that already correctly reports its state.

## Reproduction

`packages/react/e2e/canonical-authority.spec.ts`'s new "has no axe violations with checklist controls and a formula atom together" test: seed a checked checklist item, run `AxeBuilder` against `[data-smart-authority="canonical"]`. Failed with a `color-contrast` violation (`serious` impact) on `button[aria-label="Check selected items"]`, deterministically in all 3 browsers (not a flake — axe's contrast calculation is browser-independent given the same rendered colors).

## Root cause

`packages/react/src/theme.ts`'s `.srte-tool-button[aria-pressed="true"]` rule used the same `--srte-primary` blue for pressed-state text as every other "this is the brand color" usage elsewhere in the stylesheet (e.g. against solid white/dark backgrounds, where it's compliant) — but against the translucent `--srte-accent-bg` tint specifically, that exact shade falls just short of AA. Nothing had ever run a contrast checker against this specific foreground/background pairing before.

## Fix

Added a dedicated `--srte-primary-pressed` custom property: `#1d4ed8` (a darker step of the same blue) in light mode, `var(--srte-primary)` (unchanged, `#3b82f6`) in dark mode — dark mode's lighter blue against its dark canvas was not flagged and did not need adjusting. `.srte-tool-button[aria-pressed="true"]` now reads `color: var(--srte-primary-pressed)` instead of `var(--srte-primary)`. `--srte-primary` itself is untouched, so no other usage (buttons, links, focus rings) is affected.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`'s "has no axe violations with checklist controls and a formula atom together" — passes zero violations in all 3 browsers after the fix; would fail again if the pressed-state color regressed.

## Related/similar issues

[list-toggle-buttons-missing-aria-pressed](list-toggle-buttons-missing-aria-pressed.md) — same toolbar pressed-state area, different bug (missing attribute vs. insufficient contrast on a correctly-present one).
