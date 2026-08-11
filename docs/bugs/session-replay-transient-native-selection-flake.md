# Generated authority replay captured transient native selection before the model settled

**Status:** Fixed (replay harness synchronization; retained/canonical parity divergences remain separately classified)
**Area:** test infra / authority replay / selection
**First reported:** 2026-08-06 (during the Phase 8b Gate 13 replay expansion)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_8B_DELTA_REPORT_3.md`, `docs/PHASE_8B_DELTA_REPORT_4.md`

## Symptom

The generated complete-session replay could fail under load or on a second run even when the same command sequence was correct in isolation. Table merge was the clearest case: the intent could run before the projected cell selection, or the checkpoint could be captured before the model subscription and renderer selection projection completed.

## Reproduction

Run the retained/canonical or canonical/canonical replay with table merge under the full browser schedule. The old route could snapshot a transient text/native selection or compare the browser-owned native range itself, producing a false nondeterminism/parity failure. Isolated command behavior and the normalized document were otherwise correct.

## Root cause

This was primarily a test-harness race, not a new editing-semantic divergence: the table intent did not wait for `selection.type === "cell"` and the merged `colspan`, and `runSession` captured immediately after an intent. The determinism comparison also included volatile browser-native selection instead of the gate's required normalized structure plus semantic selection. A separate production-side cell-selection demotion bug existed and is recorded in [cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md).

## Fix

`packages/react/e2e/canonical-authority.spec.ts:374-375` now waits for selected-cell count, semantic cell selection, enabled Merge cells, and the resulting span. `:402-414` waits two animation frames for model/render selection projection. `:440-444` compares only ID-stripped structure and semantic selection, leaving native selection to dedicated renderer/input tests. This is synchronization, not a retry.

## Regression coverage

The generated replay now covers 42 comparable intents and passes its canonical determinism run 5/5 in Chromium; the full 348-test three-browser suite passes 343 with 5 skipped. Gate 14's 11 classified retained/canonical differences are not hidden by this fix and remain owner-disposition items.

## Related/similar issues

- [cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md) — production selection race fixed alongside the replay correction.
- [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) — separate harness readiness race, now fixed in the WebKit list-Enter test.
- [block-move-fix-regression-introduced-by-first-attempt](block-move-fix-regression-introduced-by-first-attempt.md) — renderer changes can expose replay/composition failures; rerun both before changing reconciliation again.
