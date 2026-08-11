# Clicking a block atom lost node selection and disabled Resize controls

**Status:** Fixed
**Area:** atom / selection / renderer / toolbar
**First reported:** 2026-08-05 (surfaced as the six disabled `Grow selected atom` failures in `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`)
**Related files:** `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`, `docs/PHASE_8B_BLOCK_MOVE_SELECTION_DEFECT.md`

## Symptom

Clicking an image/block atom appeared to select it, but the toolbar still treated the selection as ordinary text. `Grow selected atom`, `Shrink selected atom`, Edit, and Delete stayed disabled; the generated authority replay then timed out waiting for the resize button.

## Reproduction

On `?canonicalAuthority=1`, insert a block image, click it, and inspect the toolbar immediately. The rendered node range exists, but the model selection has already changed from `type: "node"` to a text selection after the browser emits `selectionchange`.

## Root cause

The atom click handler correctly established a semantic node selection. `syncSelectionFromDom` then imported the native range projected around that atom as a text selection, erasing the node selection before React derived `atomSelected`. This was a selection-bridge race, not a toolbar predicate or atom-command defect.

## Fix

`packages/core/src/foundation/surface/input.ts:1397-1415` preserves an existing node selection when the native endpoints exactly match its normalized range, while still importing a genuinely different native range. The toolbar's `atomSelected` state can therefore remain derived from the model. No resize command change was needed.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` (`routes lists, links, tables, atoms, resize, import, and export`) and `packages/react/e2e/canonical-authority.spec.ts` (`atom.resize`) click the atom, grow and shrink it, and pass in Chromium, Firefox, and WebKit. The full suite now has no disabled-resize failures.

## Related/similar issues

- [block-move-fix-regression-introduced-by-first-attempt](block-move-fix-regression-introduced-by-first-attempt.md) — the resize timeout was present in that renderer-blast-radius control run but had a separate selection-bridge cause.
- [cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md) — the same native `selectionchange` import hazard for semantic cell selections.
- [block-atom-following-caret-unreachable](block-atom-following-caret-unreachable.md) — separate boundary/caret behavior for block atoms.
