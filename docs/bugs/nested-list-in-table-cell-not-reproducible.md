# Nested list inside a table cell reported as unavailable

**Status:** Needs re-verification (current source passes; a fresh manual build check remains)
**Area:** table / list / scope / renderer
**First reported:** 2026-08-10/11 (canonical manual testing)
**Related files:** `docs/PHASE_3_COMPLETION_REPORT.md`, `docs/PHASE_5_COMPLETION_REPORT.md`, `docs/bugs/stale-dist-build-confusion.md`

## Symptom

A nested list created inside a table cell was reported as not working on the canonical surface.

## Reproduction

The report was not reproduced against current source. The canonical browser route creates a nested list inside a table cell, and the full three-browser suite passes that scenario. Phase 3/5 contracts also require list/block commands inside isolating table cells to work without feature-specific branches.

## Root cause

No current command, schema, or renderer defect was found. The leading explanation for the manual contradiction is stale playground output or a stale tab, because the original report predates the live-source Vite alias and the same feature passes the canonical browser route.

## Fix

No list-in-cell patch was made in this pass. The existing per-owner scope resolution and `block+` cell content contract are the intended implementation. Verify on a restarted `packages/react/playground` dev server before reopening the issue as a regression.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` (`creates a nested list inside a table cell`) and the Phase 5 list/table fixture suite cover the behavior in Chromium, Firefox, and WebKit.

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — check the live-source alias and hard-refresh before treating this as a new code defect.
- [cell-selection-demoted-by-selectionchange](cell-selection-demoted-by-selectionchange.md) — table selection state can affect which toolbar route is available, but it is a different confirmed bug.
