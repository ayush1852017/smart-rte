# No editable caret at quote/document boundaries ("Bug 4") — a two-round arc

**Status:** Fixed (re-verified in the clean 348-test three-browser run: 343 passed, 5 skipped, 0 failed)
**Area:** selection / block boundary / input
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md` (round 1) and `docs/PHASE_8B_BUG4_REOPEN.md` (round 2, a reopen of the same "Bug 4")
**Related files:** `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md`, `docs/PHASE_8B_BUG4_REOPEN.md`

## Status arc (read this first — this bug was fixed once, then reopened for a case the first fix didn't cover)

- **Round 1** (`PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md`, "bug 4"): reported as "with adjacent blockquotes, no guaranteed editable position before the first quote, between two quotes, or after the final quote." Fixed via the `foundation.editable-boundaries` normalizer (see Fix below) plus structural-sibling traversal through the nearest editable owner.
- **Round 2** (`PHASE_8B_BUG4_REOPEN.md`): reopened specifically for the case of a document whose *literal last node* is a blockquote, with the caret placed via a **native browser selection** at the root DOM boundary (not a scripted/model-level selection). Round 1's regression coverage proved the boundary paragraph existed in the model, but never proved a native root-boundary selection actually landed inside it — a real gap in round 1's own test coverage, not a re-report of the same symptom under new conditions. Root cause for round 2 was different from round 1's (see below) and required a second, more targeted fix.

## Symptom

When a document's literal last node is a `blockquote`, placing the caret at the very end of the document (root boundary, e.g. via click or select-all→Down) left the editor visually inert — no visible editable caret appeared, and typing did nothing.

## Reproduction

- **Reproduced:** set native selection at the root DOM end (`DIV`, offset = child count) with a document ending in a blockquote, dispatch `selectionchange`. Native selection collapsed at the editable root while model selection remained a structural position (`{ path: [], offset: 3 }`, not a text position) — the trailing paragraph existed in the model but the caret was never projected into it.
- **Did NOT reproduce:** select-all → Down at the same boundary — collapsed correctly into the trailing paragraph in all three browsers on the current code. Kept as a regression test anyway since it exercises a different native-collapse code path, not because it was flag-mismatched or a false alarm.
- **Did NOT reproduce (worked correctly):** toolbar-created path (list → blockquote at document end) — the boundary normalizer produces a correct trailing paragraph, remains navigable after select-all → Down.
- All testing used the canonical product surface (`?canonicalAuthority=1`) only.

## Root cause

**Round 1:** missing shared invariant — structural block edges (quote/table/atomic/isolating boundaries) had no guaranteed canonical editable owner in the model at all, and keyboard movement only inspected the immediate DOM sibling.

**Round 2:** two-part, and it's worth keeping both parts distinct since only one was actually broken *in this round*:
1. `foundation.editable-boundaries` (`packages/core/src/foundation/boundaries.ts`) was working correctly by this point — it does insert deterministic empty paragraphs around boundary blocks, including a literal final blockquote. **This part was never broken in round 2**, even though round 1's regression coverage had only proved this half existed, not that a native selection could reach it.
2. The actual round-2 gap was in the **input selection bridge**: `syncSelectionFromDom` (in `packages/core/src/foundation/surface/input.ts`) accepted `renderer.mapping.domToPos(...)` verbatim. For a root boundary, `domToPos` correctly returns a *structural* document position — but the code then stored that structural position as a *text* selection with no inline "owner," so there was no valid caret to render. The existing owner-traversal logic (`moveCaret`) was wired only for keyboard movement, not arbitrary native selection changes.

## Fix

**Round 1:** new shared `foundation.editable-boundaries` normalizer (`packages/core/src/foundation/boundaries.ts`) inserts deterministic empty paragraphs before/after quote/table/atomic/isolating boundaries as a model invariant (not a DOM `<br>` hack), registered for every transaction in `packages/core/src/foundation/editor.ts`. Structural-sibling resolution in `packages/core/src/foundation/surface/input.ts` now routes through the nearest editable owner instead of the quote/table node itself. `packages/core/src/foundation/schema.ts` also repairs malformed imported empty blockquotes.

**Round 2:** new function `editablePositionForStructuralBoundary` in `packages/core/src/foundation/surface/input.ts`. Resolves a structural DOM point to the nearest direct editable sibling first (a boundary paragraph wins over text nested in the preceding quote), falling back to nested owner traversal; direction-aware bias (collapsed root-start prefers the following owner, root-end prefers the preceding owner). The selection-sync path now normalizes both native endpoints before scope resolution and re-projects the model selection through `renderer.render` — necessary, or the browser caret stays stuck on the root `DIV` and input stays inert even with a corrected model selection. No changes were made to the boundary normalizer, commands, or renderer in round 2.

**Also within round 1's work order** (caught by the team's own full three-browser run before shipping, not an external report): the initial boundary fix didn't preserve the active/current block identity across *forward* merges at structural boundaries, causing 3-browser failures plus a replay-route failure. Fixed within the same round by preserving the active block ID on forward merges and mapping selection through the operations (folded into the same `surface/input.ts` boundary-handling code).

## Regression coverage

- Round 1: `packages/core/src/foundation/phase2_5.test.ts` (Enter-Enter inside quoted list, Backspace, forward Delete, schema validity, selection; editable positions before/between/after adjacent quotes, `posToDom`, arrow traversal); `packages/react/e2e/canonical-authority.spec.ts` (product list-exit Backspace and select-all deletion). Round 1's own final full three-browser run passed all 247 non-skipped cases at the time, including the two historically recurring WebKit tests — see [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md).
- Round 2: `packages/react/e2e/canonical-authority.spec.ts`: `"reaches the editable position after a literal final blockquote"`, `"select-all then Down collapses to the editable position after a final blockquote"`, `"keeps a toolbar-created final blockquote boundary editable"`.

## Related/similar issues

- [quoted-list-enter-enter-exit-leaves-delete-inert](quoted-list-enter-enter-exit-leaves-delete-inert.md) — a different symptom fixed by the *same* round-1 boundaries.ts change; not the same bug, same commit family.
- [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) — round 1's clean full-suite run is the earliest documented instance of the recurring WebKit flake being absent; not causally related, just temporally adjacent.
- The "stopped full-suite run" caveat on round 2 in the source report is now superseded by the clean 348-test three-browser run recorded in Status above; keep the targeted final-node and select-all-collapse cases when rerunning the suite.
- [block-atom-following-caret-unreachable](block-atom-following-caret-unreachable.md) — the same editable-boundary invariant applied to trailing media atoms rather than quotes.
