# Delete/Backspace silently did nothing (or threw) for multi-item list ranges, blockquote nodes, or code-block nodes

**Status:** Fixed
**Area:** list / block / selection (input/scope dispatch)
**First reported:** unknown — backfilled from `docs/PHASE_8B_DELETE_LIST_TYPES_INDENT_DEFECTS.md`

## Symptom

Deleting a selection spanning multiple list items, or a selected blockquote/code-block node, silently did nothing — or, for text selections crossing structural parents, threw an internal exception — instead of removing the selected content.

## Reproduction

Confirmed in the canonical input path. A selection spanning list-item text across different paths reached the plain range-deletion code, whose cross-parent branch threw an explicit "outside the canonical test surface contract" error. For a selected blockquote/code-block *node* (not text), the browser's native projected range was being re-imported as a text selection before deletion ran, losing the semantic node selection entirely — so no structural deletion target was ever produced, and the operation silently no-opped. Explicitly classified as an input/scope-dispatch defect, not a renderer or list-command defect.

## Root cause

The deletion path (`deleteRange`/`queueRangeDeletion`) had no code path for structural (non-text, cross-parent) selections at all — it assumed every deletable selection shared one inline text owner.

## Fix

New `structuralDeletionPlan` in `packages/core/src/foundation/surface/input.ts` resolves structural selections to their node IDs and plans either descending sibling removal or containing-structure replacement, covering list-selection, block-range, container-tree, mixed, and node selections without assuming a shared inline parent. The main deletion handler now chooses this plan for non-text selections and for selections crossing structural parents, mapping the caret through a preview of the resulting operations. Node selections (e.g. a selected blockquote or code block) are now preserved through Delete/Backspace and any replacement instead of being silently converted to a text selection before the semantic operation runs. Ordinary same-owner character deletion was unchanged.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`: multi-item list range; node-selected blockquote and code block; mixed list/plain-block selection. `packages/react/e2e/canonical-authority.spec.ts`: product route, 3/3 browsers. Retained editor: no equivalent canonical node-selection replay exists for quote/code selections — recorded explicitly as "no retained counterpart observed," not claimed as retained-parity-verified.

## Related/similar issues

- [select-all-delete-fails-on-structural-documents](select-all-delete-fails-on-structural-documents.md) — a related but distinct deletion-path bug (whole-document selection specifically, wrong root cause — a length-vs-string comparison bug, not missing structural dispatch).
- [list-partial-delete-removes-whole-list](list-partial-delete-removes-whole-list.md) — a later, more specific deletion bug found after this fix landed, in a scope-resolution edge case this fix didn't cover.
