# Caret reachability at the end of / after a code block created via type conversion

**Status:** Not a bug (working as designed)
**Area:** block / selection
**First reported:** unknown — backfilled from `docs/PHASE_8B_INDENT_CODE_BOUNDARY.md`

## Symptom

Concern that after converting a paragraph to a code block via the Block-type toolbar control, the caret could not reach the end of the code block's own content, or could not reach a position *after* the code block when it was the last node in the document.

## Reproduction

Selected existing paragraph text, changed its block type to `code_block`, tested both when the block was document-final and when a following paragraph existed. Both requested positions were reachable: caret placed at the end of the code block's own text worked correctly (typing extended the text, selection advanced correctly); the same check passed when the code block wasn't document-final, with the following paragraph unaffected. Neither of the originally-suspected failure modes reproduced.

## Root cause

None — this report conflated two different things. "A position after the code block" when it's document-final is a *different, deliberate* contract than "the end of its own content": a code block is itself a fully editable owner (unlike a quote/table/atomic boundary), so the boundary-normalizer logic that adds a trailing paragraph after other structural boundaries intentionally does **not** add one after every code block. The documented, intended way to get past a trailing code block is Ctrl/Cmd+Enter, or pressing Enter on a trailing empty line inside it — not an "after the block" position that would need to be conjured automatically.

## Fix

None. Explicitly noted that adding an automatic trailing paragraph after every final code block would be a genuine behavior/schema change, not a repair to the originally-reported bug, and should only happen via a deliberate contract decision if ever wanted.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: conversion at document end and non-document-end, asserts model and native caret state, types at the end, verifies a non-final following block is unaffected; 3/3 browsers.

## Related/similar issues

- [code-block-in-blockquote-enter-handling-not-a-bug](code-block-in-blockquote-enter-handling-not-a-bug.md) — a related but distinct code-block investigation (Enter/newline handling when nested in a quote, not end-of-content/document-end reachability after conversion). Also not a bug, different mechanism.
