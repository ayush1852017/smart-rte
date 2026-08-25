# Merging cells across an entire row's width can produce a schema-invalid empty `table_row`

**Status:** Fixed
**Area:** table
**First reported:** 2026-08-18, during Phase 8c's fine-grained table-operations conversion, when the merge/split/move-column fuzz coverage was widened
**Related files:** `packages/core/src/foundation/table/commands.ts` (`mergeTableCellsCommand`), `packages/core/src/foundation/table/grid.ts` (`occupancyGridFor`, `repairTableGeometry`)

## Symptom

`mergeTableCellsCommand`, when merging a rectangular selection that spans two or more rows and covers a row's entire width, absorbs all of that row's own cells into the merged anchor cell (which gets a `rowspan` covering that row). The row node itself keeps existing (removing it would break `rowspan` bookkeeping, which counts physical `table_row` elements), but ends up with `children: []`. `validate()` rejected this as `"invalid-content"` because `table_row`'s content spec was `"table_cell+"` (one or more), not `"table_cell*"`.

This reproduced even for the simplest case — merging an entire 2x2 table into one cell — via the existing (pre-Phase-8c) `table.test.ts` test "merges in reading order...", once `expect(validate(merged)).toEqual([])` was added after the merge. The merge itself had always produced this structure; nothing previously asserted `validate()` on the result.

## Reproduction

`table/table.test.ts`'s "preserves a valid single-claim grid and exact undo state across 1,000 generated sequences" fuzz test, once widened (as part of Phase 8c item 2) to include `mergeTableCellsCommand` in its random operation menu, hit this within the first ~50 seeded runs — `validate(model)` failed with `"invalid-content"` / `"Children do not match \"table_cell+\"."` on a row entirely covered by a merge.

## Root cause

`occupancyGridFor`/`validateTableGeometry` (`grid.ts`) mark every row a `rowspan` cell *covers*, not just the row it's physically anchored in — a row with zero own `table_cell` children but full rowspan coverage from an earlier row is geometrically complete (no "hole"), and is the correct, necessary structure (mirrors how HTML `rowspan` requires the covered `<tr>` to still exist, possibly with no `<td>` of its own). The schema's `table_cell+` content spec didn't account for this and was simply too strict.

Two fix directions were considered and rejected before landing on relaxing the schema:
- **Reject the merge** (an initial guard added and then reverted): rejects even the ordinary, correct "merge the whole table into one cell" case, which the existing pre-Phase-8c test explicitly exercises as intended behavior.
- **Delete the now-empty row instead of leaving it empty**: breaks `occupancyGridFor`'s `grid.rows` count (derived from actual `table_row` children), which would make the anchor's own `rowspan` an "overhang" past the end of the table — trading a schema violation for a geometry violation.

An investigation into blast radius (DOCX export via `docx/export.ts`'s grid-based `tableXml`, HTML export, React/DOM rendering, `repairTableGeometry`) found no code that assumes a `table_row` always has at least one child — all of it is grid/`occupancyGridFor`-driven, not `row.children`-driven. The investigation also found that `repairTableGeometry` could independently produce the same zero-child-row structure for any malformed/imported table with a full-row-covering rowspan cell, meaning `repair()`'s "always produces a valid document" contract was already quietly at risk from this same gap, unrelated to merge.

## Fix

Relaxed `table_row`'s content spec in `packages/core/src/foundation/table/schema.ts` from `"table_cell+"` to `"table_cell*"`, with a comment explaining why a fully-covered, zero-cell row is legitimate. No changes needed to `grid.ts`, DOCX/HTML export, or React rendering — all already handle it correctly.

## Regression coverage

`table/table.test.ts`'s "merges in reading order..." test's assertions continue to pass. The widened 1,000-seed fuzz test (seed `0x6A1D2026`, now including merge/split/move-column) asserts `validate(model) === []` after every step and is the primary regression guard.

## Related/similar issues

[setnodeattributes-reorders-keys-breaking-exact-match](setnodeattributes-reorders-keys-breaking-exact-match.md) — found via the same fuzz-test-widening pass, a different bug in the same investigation.
