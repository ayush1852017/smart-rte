# Shift+ArrowLeft / Shift+ArrowRight collapsed the caret instead of extending the selection

**Status:** Fixed
**Area:** core - `foundation/surface/input.ts` (`moveCaret`)
**First reported:** 2026-09-15, live question — "Should I expect shift+left arrow and shift+right arrow to select text before and after of the cursor?"
**Related files:** [shift-home-end-does-not-extend-selection](shift-home-end-does-not-extend-selection.md) — the identical bug class, already fixed once for Home/End but never carried over to plain arrows. [arrow-key-collapse-ignores-direction](arrow-key-collapse-ignores-direction.md) — a different, already-fixed bug in the same handler (which endpoint a *bare* arrow collapses a range to); unaffected by this fix, still correct.

## Symptom

Holding Shift while pressing ArrowLeft or ArrowRight moved the caret one character in that direction instead of extending the selection — the standard "select the character before/after the cursor" keyboard gesture did nothing selection-wise outside of a table cell (where a separate, already-correct `handleTableShiftArrow` path exists).

## Investigation

`handleKeyDown`'s ArrowLeft/ArrowRight branch always called `event.preventDefault()`, then either collapsed an existing non-collapsed range (only when `!event.shiftKey`) or fell through to `this.moveCaret(direction, modifier || event.altKey)` — with `event.shiftKey` never read or passed into `moveCaret` at all. `moveCaret` itself unconditionally built `{ type: "text", anchor: next, head: next }` at every return path, with no notion of "extend from the current anchor" whatsoever. So a Shift+Arrow press hit the exact same code as a plain arrow press: preventDefault blocked the browser's own native extend behavior, and the replacement always collapsed.

## Fix

`moveCaret` gained a third parameter, `extend = false`. Its final selection assignment is now `anchor: extend ? selection.anchor : next` — preserving the anchor from before this movement when extending, matching exactly how the Shift+Home/End fix already does this. The ArrowLeft/ArrowRight call site now passes `event.shiftKey` as that argument.

Scope: this covers ordinary intra- and cross-owner text movement (the vast majority of `moveCaret`'s calls, including crossing into an adjacent paragraph/list-item/blockquote's nearest editable position). It does **not** thread `extend` into `moveFromStructuralBoundary` (the narrower fallback for starting the gesture already positioned on a non-inline-owner node, or an isolating container with no adjacent editable content at all) — extending a text selection onto or through a structural/atomic node is a different selection shape entirely, out of scope here, matching how the sibling arrow-collapse fix similarly scoped itself to "non-collapsed text selections... node/cell navigation keeps its existing, separate behavior."

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`: "extends the selection with Shift+ArrowLeft/Right instead of collapsing it" — two consecutive Shift+ArrowLeft presses keep the same anchor while `head` moves back; a following bare ArrowRight still collapses to the range's own normalized endpoint (the pre-existing, correct, unrelated behavior); a second case confirms the anchor is preserved when the movement crosses into an adjacent paragraph. Confirmed to fail without the fix via `git stash`.

`packages/react/e2e/canonical-authority.spec.ts`: "Shift+ArrowLeft and Shift+ArrowRight actually extend the selection instead of moving a collapsed caret" — real keyboard input in a live browser, confirmed to fail without the fix (anchor moved together with head) via `git stash` + rebuild. Full Shift/arrow/table-cell-shift-arrow test group (27 tests) passed across all 3 browsers, confirming no regression to the table-cell rectangular Shift+Arrow selection path, which is unaffected (separate code path, untouched).

Full suites: core 762/762 (+1), react 151/151, typecheck and lint clean.
