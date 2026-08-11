# Select-all + Backspace/Delete failed to clear documents containing lists/tables/atoms

**Status:** Fixed
**Area:** selection / input
**First reported:** unknown — backfilled from `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`

## Symptom

Select-all followed by Backspace or Delete failed to clear the document, specifically for structural documents (containing lists, tables, or block atoms). Native select-all was visually correct; the deletion silently didn't apply.

## Reproduction

Reproduced directly, "especially for structural documents" (plain-text-only documents were less affected/not the primary case).

## Root cause

The whole-document-range detection (`isWholeDocumentRange`) compared the selection's end offset against the resolved inline owner's *text string value* rather than its numeric UTF-16 length — so for many structural documents the comparison never matched the true document end, and the code never routed into the canonical clear-document path at all.

## Fix

`packages/core/src/foundation/surface/input.ts` — document-end calculation now compares the offset against `inlineText(node).length` (a number) instead of the text value itself. The existing whole-document deletion path was otherwise correct and unchanged: it emits the schema-valid single empty paragraph and maps the caret to `[0], offset 0`.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts` (plain, list, table, and block-atom documents); `packages/react/e2e/canonical-authority.spec.ts` (native Ctrl/Cmd+A + Backspace/Delete for both ordinary and mixed list/table/atom documents, 6/6 across 3 browsers × 2 deletion keys). Retained editor unaffected — it uses the native browser deletion path, no corresponding failure, no retained code changed.

## Related/similar issues

- [multi-block-delete-fails-for-list-quote-code](multi-block-delete-fails-for-list-quote-code.md) — a related but distinct deletion-path bug (partial/multi-block selections, not whole-document) found in a different round.
