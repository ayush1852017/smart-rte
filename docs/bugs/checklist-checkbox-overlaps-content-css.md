# Checklist checkbox control visually overlapped the item's text content

**Status:** Fixed
**Area:** renderer / list (checklist) / CSS
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_ENTER_LIST_TYPES_CODE_CHECKLIST.md`

## Symptom

The checklist checkbox control visually overlapped the item's text content, for both top-level and nested checklist items.

## Reproduction

Reproduced for both top-level and nested checklist items.

## Root cause

The projected checkbox control was correctly placed in CSS grid column 1 by the renderer/theme, but the playground's *global* `button` CSS rule applied default padding, a border, and a large intrinsic width to it (since it's a real `<button>` element and inherited the page's generic button styling), causing it to visually extend into grid column 2 (the content column). Explicitly characterized as a renderer/theme CSS contract issue — no model, state, or ARIA bug involved.

## Fix

`packages/react/src/theme.ts` — the checklist control selector now resets default button styling (padding, border, radius, background, font, appearance, width, box-sizing) while retaining its existing grid placement and projected attributes. DOM placement and the checkbox's role/state were untouched. The retained (legacy) editor already had an equivalent inline style reset, which is why this was canonical-only.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: measures control/content bounding rectangles for both top-level and nested items, asserts a non-negative gap and correct grid-column placement; 3/3 browsers.

## Related/similar issues

- [checklist-checkbox-border-ring-artifact](checklist-checkbox-border-ring-artifact.md) — a different checklist-checkbox CSS bug (unwanted border/ring, plus an unrelated toggle no-op), different root cause.
- [checklist-checkbox-aria-checked-stale-after-toggle](checklist-checkbox-aria-checked-stale-after-toggle.md) — a third, also-distinct checklist-checkbox bug (stale ARIA state from renderer subtree-diffing, not CSS at all).
