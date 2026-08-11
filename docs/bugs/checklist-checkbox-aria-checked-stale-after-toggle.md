# Checklist checkbox: model toggled correctly but rendered `aria-checked` didn't update

**Status:** Fixed
**Area:** list / renderer / toolbar
**First reported:** unknown — backfilled from `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`
**Related files:** `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`

## Symptom

Toggling a checklist item's checked state via the toolbar updated the model correctly, but the rendered checkbox's `aria-checked` attribute did not reflect the change.

## Reproduction

Confirmed as an end-to-end (browser) symptom. Both the model state and the toolbar's command routing were independently verified correct — the bug was isolated specifically to rendering.

## Root cause

Reference-identity subtree skipping in the incremental renderer left the projected checkbox stale even though the underlying list's `checkable`/item's `checked` state changed in the model — the renderer's diffing short-circuited on the subtree without re-checking the projected control's own attributes.

## Fix

New `syncListProjections` step in `packages/core/src/foundation/surface/renderer.ts`, invoked from both initial and incremental render, reconciles list/list-item projections idempotently from current model attributes rather than relying on subtree-identity skipping to have already caught the change.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts`, 3/3 browsers.

## Related/similar issues

- [checklist-checkbox-border-ring-artifact](checklist-checkbox-border-ring-artifact.md) — a different checklist-checkbox bug (toggle no-op + CSS border artifact) found in a later round; different root cause (missing click route + missing `data-checked` attribute, not stale subtree diffing), same general "projected checkbox" feature area.
- [checklist-checkbox-overlaps-content-css.md](checklist-checkbox-overlaps-content-css.md) — yet another distinct checklist-checkbox CSS bug (visual overlap, not staleness), also unrelated root cause.
