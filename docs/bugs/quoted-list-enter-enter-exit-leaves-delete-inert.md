# List inside a blockquote: Enter-Enter exit leaves Backspace/Delete inert

**Status:** Fixed
**Area:** list / block / selection (structural boundaries)
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md`
**Related files:** `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md`

## Symptom

A list nested inside a blockquote, followed by pressing Enter twice on the resulting empty depth-zero item (the standard "exit the list" gesture), left the editor in a state where Backspace or Delete became inert (no-op).

## Reproduction

Confirmed directly on the canonical surface: list-in-quote → Enter → Enter on the empty item → attempt Backspace/Delete.

## Root cause

Shared invariant violation with [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md): structural block edges (quote/table/atomic/isolating boundaries) had no guaranteed canonical editable owner, and keyboard movement only inspected the immediate DOM sibling. The Enter-Enter path additionally exposed stale selection handling when an empty paragraph was removed or a forward merge crossed a structural parent.

## Fix

Same fix as the linked quote-boundary issue: the shared `foundation.editable-boundaries` normalizer (`packages/core/src/foundation/boundaries.ts`) plus structural-sibling resolution through the nearest editable owner (`packages/core/src/foundation/surface/input.ts`). The list-exit blank-line case specifically preserves the current owner ID on forward deletion and the preceding owner on backward deletion, so the active caret's block is never retired mid-operation.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts` (Enter-Enter inside quoted list, Backspace, forward Delete, schema validity, selection); `packages/react/e2e/canonical-authority.spec.ts` (product list-exit Backspace and select-all deletion, 3 browsers).

## Related/similar issues

- [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md) — same commit/fix family, different symptom.
- [list-enter-exit-silent-throw-missing-split-id](list-enter-exit-silent-throw-missing-split-id.md) — a different, later bug in the same general "Enter exits a list" feature area, unrelated root cause (missing command parameter, not missing boundary invariant).
