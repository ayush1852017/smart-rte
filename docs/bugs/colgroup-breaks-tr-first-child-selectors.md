# Adding `<colgroup>` broke `tr:first-child`-based selectors in existing e2e tests

**Status:** Fixed
**Area:** table / renderer / test infrastructure
**First reported:** 2026-08-19, self-caught during Phase 11.5 §2.2 verification (not a user report) — introduced by the same pass's `table-column-width-not-rendered.md` fix.
**Related files:** `packages/react/e2e/canonical-authority.spec.ts`, `packages/react/e2e/canonical-toolbar-routing.spec.ts`

## Symptom

After `surface/renderer.ts` started rendering `table.attrs.columnWidths` as a real `<colgroup>` (a genuine DOM sibling inserted before the `<tr>` rows), two pre-existing, previously-passing e2e tests failed consistently across all 3 browsers: `"keeps table row and column move owners aligned while typing"` and `"creates a nested list inside a table cell"`. Both used a CSS selector of the form `table tr:first-child td:first-child ...`.

## Reproduction

`table tr:first-child` requires the `<tr>` to be the literal first child element of `<table>`. Once the renderer began inserting `<colgroup>` before the rows (whenever `columnWidths` is set — which every table created via the "Insert table" toolbar button has by default, per `commands.ts`'s `insertTableCommand`), the first `<tr>` was no longer `:first-child` — the colgroup was. `placeCaret`'s `toBeAttached()` check on the selector then found zero matches and timed out.

## Root cause

Not a product bug — a test-selector assumption that happened to hold only because no table content had ever had a non-`<tr>` sibling before this pass. `:first-child` is a positional-among-all-siblings selector; the tests' actual intent was "the first row," which should have been expressed as `:first-of-type` (first sibling of that specific tag name) from the start.

## Fix

Replaced every `tr:first-child` occurrence in both e2e spec files with `tr:first-of-type`, which matches the first `<tr>` regardless of what other element types (like `<colgroup>`) precede it. `td:first-child`/`li:nth-child` occurrences were left unchanged — colgroup only affects `<table>`'s direct children, not `<td>`'s or `<li>`'s siblings.

## Regression coverage

The two originally-failing tests now pass in all 3 browsers with the `:first-of-type` selectors. `packages/core/src/foundation/surface/tableColumnWidth.test.ts` (from the colgroup rendering fix itself) locks in the `<colgroup>` behavior that triggered this; a full 3-browser e2e run (290 passed / 7 skipped / 0 failed) confirms no other selector in the suite was affected.

## Related/similar issues

[table-column-width-not-rendered](table-column-width-not-rendered.md) — the fix that introduced this; both are part of the same Phase 11.5 §2.2 pass, found and closed together rather than shipping the renderer fix without checking its blast radius on existing coverage.
