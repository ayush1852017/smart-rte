# Checklist projected checkbox: no-op toggle click, plus unwanted default button border/ring

**Status:** Fixed
**Area:** list / checklist / renderer / toolbar CSS
**First reported:** 2026-08-10 (this project's ongoing list-toolbar bug hunt)
**Related files:** `docs/PHASE_8B_MIXED_SCOPE_DROPDOWN_CHECKLIST_PRESET.md` (§3)

## Symptom

Two distinct symptoms sharing the same projected-control lifecycle:
1. Clicking the rendered checkbox did nothing — the checked state never toggled.
2. The checkbox control also showed a visible default browser button border/outline that wasn't intended (only the small inner checkbox-square border was meant to be visible).

## Reproduction

Toolbar-create a checklist, click the projected checkbox control in the browser. Confirmed via Playwright in all three browsers.

## Root cause

Two separate, unrelated causes behind the two symptoms — this was not one bug wearing two faces:
- **Toggle no-op:** the canonical surface's click listener (`surface/input.ts`) originally handled atomic-node click targets only; there was no route that resolved a `[data-smart-ui="check-control"]` click target to its containing list item and called `setListChecked`.
- **Visual artifact:** the renderer set `aria-checked` on the control but never set the `data-checked` attribute that the checklist's CSS pseudo-element rules keyed off, and the theme didn't reset the native `<button>` border/outline, leaving the browser's default focus/border styling visible alongside the intentional inner checkbox-square border.

## Fix

- Click route: `packages/core/src/foundation/surface/input.ts` — resolves the containing `list_item` by ID from the `check-control` click target and commits `setListChecked` without disturbing the current model selection.
- Renderer: `packages/core/src/foundation/surface/renderer.ts` — projects `data-checked` and a state-specific accessible label (`"Mark complete"`/`"Mark incomplete"`) in addition to `aria-checked`.
- Theme: `packages/react/src/theme.ts` — resets the native button border/outline on the checklist control, keeping only the intentional focus-visible ring and the checkbox-square pseudo-element border.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: a test asserting initial `aria-checked`, computed button border/outline, the intentional pseudo-border, click-to-checked with updated accessible label, and click-to-unchecked. Passes in all three browsers.

## Related/similar issues

- [checklist-space-key-hijacked-by-toggle](checklist-space-key-hijacked-by-toggle.md) — same projected-checkbox control, different symptom, same investigation round.
