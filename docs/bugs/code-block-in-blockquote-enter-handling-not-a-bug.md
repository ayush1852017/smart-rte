# Code block nested inside a blockquote: Enter/newline handling — no defect found

**Status:** Not a bug (working as designed)
**Area:** block / mark (code) / selection
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_ENTER_LIST_TYPES_CODE_CHECKLIST.md`

## Symptom

Concern that pressing Enter/newline inside a code block nested in a blockquote might incorrectly exit the quote or an enclosing list, or otherwise mishandle the structural boundary, by analogy with other boundary bugs found in this same area (see [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md)).

## Reproduction

Reproduced the nested case directly against current input/renderer state: confirmed Enter inserts a plain newline inside the code block, the quote remains a single wrapper, and no list/quote exit occurs. A standalone (non-quoted) code block was confirmed to follow the same path.

## Root cause

None — explicitly rejected. The Enter handler checks for list-input context first, then routes to code-block-newline handling; the code command identifies its target purely by exact structural path. A blockquote ancestor does not alter that lookup or intercept the event in any way. The "shared boundary mechanism" hypothesis (that this might share a cause with the quote-boundary bugs) was explicitly tested and marked "not confirmed."

## Fix

None — no speculative boundary patch was made, since no defect was found to fix.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts` (core); `packages/react/e2e/canonical-authority.spec.ts` (product, 3/3 browsers). Retained editor uses native `<pre>` editing with its own green code/list tests but no equivalent quote+code Enter test exists — no retained-parity claim is made either way.

## Related/similar issues

- [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md) and [quoted-list-enter-enter-exit-leaves-delete-inert](quoted-list-enter-enter-exit-leaves-delete-inert.md) — the real boundary bugs this report was checked against by analogy; this one turned out not to share their cause.
- [code-block-converted-caret-reachability-not-a-bug](code-block-converted-caret-reachability-not-a-bug.md) — a different, also-not-a-bug investigation into code block caret behavior (end-of-content/document-end reachability after type conversion, not Enter-key handling).
