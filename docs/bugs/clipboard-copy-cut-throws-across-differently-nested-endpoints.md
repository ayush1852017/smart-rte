# Copy/cut throws "Clipboard copy is clamped to one structural parent." for any selection whose endpoints aren't immediate siblings

**Status:** Fixed
**Area:** core - `foundation/clipboard/transfer.ts` (`sliceClipboardSelection`, `deleteClipboardSelection`), wired into `foundation/surface/input.ts` (`handleCopy`, `handleCut`, `handleDragStart`)
**First reported:** 2026-09-08, via a real browser console error surfaced mid-session: `Uncaught Error: Clipboard copy is clamped to one structural parent. at sliceClipboardSelection (transfer.ts:47:67) at FoundationInputPipeline.handleCopy (input.ts:668:45) at FoundationInputPipeline.copyListener (input.ts:604:49)`.
**Related files:** `docs/bugs/partial-cross-paragraph-selection-delete-removes-unselected-content.md` - same general family (an endpoint-resolution routing condition written for a narrower shape than the selections real users actually make), but a different function/module and a different failure mode (a crash, not silent data loss).

## Symptom

Selecting text starting in one block and ending in a block that is **not its immediate structural sibling** - e.g. from a plain paragraph into a paragraph nested inside a list item, or between two list items at different nesting depths (one inside a sub-list, one not) - and then copying, cutting, or starting a native drag threw an **uncaught JS error**, unprevented and unrecoverable from the caller's side. Nothing was copied to the clipboard; the keyboard/mouse gesture that triggered it appeared to silently do nothing beyond the console error.

This is not an exotic shape: any selection that starts before a list (or table, or blockquote) and is dragged into it, or spans two items at different list-nesting depths, hits this. Only a selection between two blocks that are **direct children of the exact same parent** avoided it.

## Root cause

`sliceClipboardSelection` and `deleteClipboardSelection` (`transfer.ts`) each had exactly two handled shapes:

1. Both endpoints resolve to the same owner node (`samePath(from.path, to.path)`).
2. Both endpoints' owners share the same **immediate** parent (`samePath(parentPath, to.path.slice(0, -1))`) - handled as a flat sibling-range slice/merge.

Anything else - which includes the extremely ordinary case of two endpoints at *different depths* under a common ancestor further up the tree - fell through to an explicit `throw new Error("Clipboard copy is clamped to one structural parent.")` (copy/drag) or the equivalent message for delete. This is the same shape of bug as the earlier partial-cross-paragraph delete fix: a routing condition ("do the endpoints share an immediate parent?") that's far narrower than "can this actually be handled," thrown as a hard error instead of degrading gracefully or handling the general case.

Unlike the earlier delete-routing bug (which mis-routed to an over-eager *other* handler), this one had no handler at all for the general case - it was never implemented, only guarded against with a throw, and `handleCopy`/`handleCut`/`handleDragStart` in `input.ts` called it with no try/catch, so the throw propagated all the way to an uncaught exception.

## Fix

Generalized both functions to handle two endpoints under **any** common ancestor, not just an immediate one:

- Find the longest common path prefix between the two endpoints (`commonPrefixLength`) to locate their nearest shared ancestor.
- Under that ancestor, the two endpoints' own top-level branches are resolved (`fromBranch`/`toBranch`), any branches fully between them are included/removed wholesale (unchanged from the existing sibling logic), and each endpoint branch is recursively trimmed via two new mirror-image helpers:
  - `afterSlice(node, path, offset)` - keeps only content at-or-after the position, recursively descending through intermediate container levels (dropping earlier siblings entirely at each level, keeping later ones fully) down to the leaf level where `split()` does the actual text trim.
  - `beforeSlice(node, path, offset)` - the mirror, keeping only content strictly before the position.
- `sliceClipboardSelection` (copy/drag, read-only) uses `afterSlice` for the "from" branch and `beforeSlice` for the "to" branch - it just extracts what's selected.
- `deleteClipboardSelection` (cut) uses the opposite pairing - `beforeSlice` for "from" (keep the unselected head) and `afterSlice` for "to" (keep the unselected tail) - and, since the two endpoints no longer share an immediate parent, does **not** attempt to merge them into one owner the way the existing same-parent case does (merging a plain paragraph with a differently-typed/nested node doesn't make sense); it leaves both trimmed branches in place as siblings under their common ancestor, mirroring the deliberately-conservative shape `structuralDeletionPlan` already uses for genuinely structural deletions elsewhere in the codebase.
- The existing same-path and same-immediate-parent branches are untouched (still separately tested, still produce the same merge-into-one-owner behavior they always did).
- As defense in depth, `handleCopy`, `handleCut`, and `handleDragStart` (`input.ts`) now wrap their clipboard-model calls in `try/catch`, pushing `"copy-rejected"` / `"cut-rejected"` / `"dragstart-rejected"` onto the existing `unhandled` diagnostics array instead of letting any future edge case in this area surface as an uncaught error again.

## Regression coverage

`packages/core/src/foundation/clipboard/transfer.test.ts`, new `describe("clipboard copy/cut across endpoints with no shared immediate parent", ...)`: a document with a plain paragraph followed by a 3-item list (one item nested two levels deeper than the selection's start), selection spanning from mid-paragraph into the second list item - asserts `sliceClipboardSelection` returns the correctly-trimmed two-branch fragment (dropping the fully-covered first list item entirely) instead of throwing, and `deleteClipboardSelection` produces operations that trim both endpoints in place without merging them, leaving the correct remaining document.

`packages/react/e2e/clipboard-workflows.spec.ts`, new test `"copies and cuts a selection crossing into a differently-nested list item without throwing"`: real `handleCopy`/`handleCut` calls (via the same `runtime.pipeline` pattern the existing clipboard e2e tests use) against the playground's `?lists=1` document, spanning from a top-level list item into a paragraph nested inside a sub-list two levels deeper - confirms no exception on either copy or cut, correct clipboard `text/plain` content, and correct post-cut document shape. Passed 12/12 (3 browsers × 4 tests in the file) including this new test.

Full suites: core 749/749 (was 745 baseline + 2 unit tests here + 2 pre-existing not yet counted this session), react unit 151/151, typecheck clean on core.

## Related/similar issues

- [partial-cross-paragraph-selection-delete-removes-unselected-content](partial-cross-paragraph-selection-delete-removes-unselected-content.md) - same underlying pattern (a same-immediate-parent-only routing check that's narrower than the selections real users make), found in the sibling `deleteRange`/`structuralDeletionPlan` code path in `input.ts` rather than here in `transfer.ts`; that one silently over-deleted instead of throwing, so the two bugs were only found via unrelated reports despite the structural resemblance.
