# Enter-splitting a block inside a styled run lost inline marks on the new block

**Status:** Fixed
**Area:** block / mark / input
**First reported:** unknown — backfilled from `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`

## Symptom

Splitting a block with Enter, at a caret position inside a run with mixed marks (e.g. bold + color + font size), caused the text after the caret to move into the new block with its marks lost/reset to default. Also reported as "content rearranged below" — clarified during investigation that this was not actual model corruption or reordering; the later block retained its original ID and text, and the apparent "movement" was a side effect of the malformed split, not real reordering.

## Reproduction

Reproduced with an Enter split occurring inside a multi-mark run — the model itself showed the mark loss (not merely a paint/CSS issue).

## Root cause

A chain of four related issues in the split/insertion path, not one single bug:
1. The old Enter-split logic flattened the tail content into plain text instead of preserving each child run and its marks.
2. The paragraph-insertion logic needed the correctly-partitioned (mark-preserving) tail to build the new block from.
3. Mark resolution exactly at the split point needed an inclusive-boundary rule (which side of a mark boundary the new caret "inherits" marks from), rather than treating the whole block as having one uniform mark set.
4. A structural transaction (which a block split is) would ordinarily clear stored marks as a side effect, losing the marks that should have carried into the next insertion at the new caret.

## Fix

The child-splitting logic in `packages/core/src/foundation/surface/input.ts` now partitions text children without flattening marks, and carries hard breaks/inline atoms as indivisible children. Paragraph insertion uses that partition and resolves marks via a new `marksAtInsertion` helper in `packages/core/src/foundation/marks/stored.ts`, which applies the inclusive-boundary rule. A new explicit "stored marks" distinction in `packages/core/src/foundation/editor.ts` preserves marks active at the new block's caret across the otherwise-mark-clearing structural transaction.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts` (multi-mark mid-run split — later-node identity/text, caret/stored marks; mark-boundary split — unchanged later structure); `packages/react/e2e/canonical-authority.spec.ts` (product-level, 3/3 browsers). Retained editor uses a different (legacy/browser-native) split path — no matching regression observed, no retained code changed.

## Related/similar issues

None identified with the same root cause.
