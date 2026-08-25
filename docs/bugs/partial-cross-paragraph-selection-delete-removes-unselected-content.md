# Partial selection spanning two (or more) paragraphs deletes the ENTIRE paragraphs, including unselected text

**Status:** Fixed
**Area:** selection / deletion (input scope dispatch)
**First reported:** 2026-08-26, reported as "selecting partway into line 1 through partway into line 2 of a 3-line document and pressing Backspace/Delete removes both lines, extending beyond the selection" - reported urgent, same severity class as this project's mammoth/merge-orphan findings.
**Related files:** `packages/core/src/foundation/surface/input.ts` (`deleteRange`, `structuralDeletionPlan`, `queueRangeDeletion`), `docs/bugs/multi-block-delete-fails-for-list-quote-code.md`, `docs/bugs/list-partial-delete-removes-whole-list.md` (same family: scope-resolution over-inclusion during deletion)

## Symptom

**Real, confirmed data loss beyond the selection - not a surprising-but-correct merge.** A selection covering the tail of one paragraph through the head of the next (leaving any further paragraph completely untouched) did not merge the surviving text on either end, as correct cross-paragraph deletion should - it deleted **both partially-selected paragraphs in their entirety**, including the unselected prefix of the first and the unselected suffix of the second.

Precise repro (per the report's own request, using marked text to distinguish real loss from a misleading-but-correct merge): document with paragraphs `"AAAA"`, `"BBBBCCCC"`, `"DDDD"`. Select from offset 2 in paragraph 1 (`"AA|AA"`) to offset 4 in paragraph 2 (`"BBBB|CCCC"`) - i.e. select `"AA"` + `"BBBB"`, leaving `"AA"` and `"CCCC"` unselected, and paragraph 3 (`"DDDD"`) completely untouched.

- **Correct result** (what `queueRangeDeletion` would have produced): one paragraph `"AACCCC"`, plus `"DDDD"` - 2 paragraphs total.
- **Actual result before the fix**: document collapsed to just `"DDDD"` - 1 paragraph. `"AA"` and `"CCCC"` - text that was never selected - were destroyed along with the selected text.

Confirmed identical for both **Backspace and Delete** (same code path, `deleteRange`, reached either way for a non-collapsed selection). Confirmed with a plain 2-paragraph document too (no untouched third paragraph needed to trigger it) - the bug is universal to any partial cross-paragraph text selection, not specific to the 3-paragraph shape in the original report.

## Reproduction

At the model level (not just visually), via `createFoundationEditor`/`createInputPipeline` dispatching a real `beforeinput` event with `inputType: "deleteContentForward"` or `"deleteContentBackward"` against the exact document/selection above - see `packages/core/src/foundation/phase2_5.test.ts`'s new "partial cross-paragraph selection delete" describe block for the exact before/after JSON. Independently re-confirmed in a real browser (Chromium/Firefox/WebKit) via real typing and native `Selection`/`Range` APIs, not just the unit harness - see `packages/react/e2e/partial-cross-paragraph-delete.spec.ts`.

## Root cause

`deleteRange`'s routing (`surface/input.ts`) decides between two deletion strategies:

```ts
const structural = (this.editor.selection.type !== "text"
  || !samePath(range.from.path, range.to.path))
  ? structuralDeletionPlan(this.editor, this.editor.selection, range)
  : null;
```

Any text selection whose endpoints have *different* paths - which includes the single most ordinary "select across a paragraph break" gesture - was routed through `structuralDeletionPlan`, a function meant for genuinely structural selections (a selected list-item range, a selected blockquote/table-cell node). `structuralDeletionPlan` falls back through `list-selection` → `block-range` → `container-tree` scope resolution to find "touched" node ids. **`block-range`'s own contract is correct for what it was built for** (a command like "make every block the selection touches a heading" should apply to a block even if only partially selected) **but is wrong when reused for deletion**: it returns both paragraphs as fully "in scope" the moment the selection touches any part of them, and `structuralDeletionPlan` then genuinely removes both nodes in their entirety - there is no trim/merge step in that code path, because for its intended (structural) use case, whole-node removal is exactly correct.

Meanwhile, `queueRangeDeletion` (the function this should have reached) already has full, correct, previously-untriggered logic for exactly this shape: same-parent siblings, forward order, compatible owner types - it trims the tail of the first owner, trims the head of the last, removes any *fully*-covered siblings in between, and merges the two trimmed ends via a `mergeNode` operation. It was simply never reached, because the routing condition's `!samePath(...)` check is far broader than "genuinely needs structural handling" - it fires on every ordinary multi-paragraph selection, not just ones `queueRangeDeletion` actually can't handle (different parents entirely, e.g. two different list items).

This is the same *family* of bug as `list-partial-delete-removes-whole-list.md` (partial coverage silently promoted to whole-node treatment during a delete) and `multi-block-delete-fails-for-list-quote-code.md` (the routing/dispatch layer between text-range and structural deletion), but a distinct instance affecting plain paragraphs, not lists specifically, and a more severe outcome (destroys unselected text within the endpoint blocks, not just over-scopes to a sibling boundary).

## Fix

Added `FoundationInputPipeline.canMergeAsSiblings(range)` (`surface/input.ts`), mirroring `queueRangeDeletion`'s own same-parent/forward-order/compatible-type checks. `deleteRange`'s routing now only falls through to `structuralDeletionPlan` when the selection is non-text, **or** the endpoints have different paths **and** `canMergeAsSiblings` says `queueRangeDeletion` genuinely can't handle it (different parents, incompatible owner types, or backward order). A selection whose endpoints are different children of the *same* parent, with the same owner type, in forward order, now correctly falls through to `queueRangeDeletion` regardless of how much or little of each endpoint paragraph is selected. Genuinely structural selections (different list items, table cells, node/cell selections) are unaffected - `canMergeAsSiblings` returns `false` for them, preserving existing, separately-tested behavior exactly.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`, "partial cross-paragraph selection delete (URGENT, 2026-08-26)": the exact 3-paragraph repro via Delete and via Backspace; a 4-paragraph selection spanning two fully-covered middle paragraphs (confirms the "remove fully-covered siblings between" behavior still fires); the same shape in a plain 2-paragraph document; and an explicit guard test confirming a genuinely cross-list-item selection is unaffected (still fully removes the touched items, unchanged). `packages/react/e2e/partial-cross-paragraph-delete.spec.ts`: real-browser Delete and Backspace, confirmed clean on Chromium and WebKit across repeated runs; Firefox has an unrelated seeding flake in this specific test file (the `Ctrl+A`-then-type setup used to establish exact starting text doesn't reliably clear the playground's placeholder content on Firefox, corrupting the *test's own seed*, not the deletion behavior) - the actual fix was independently confirmed correct on Firefox via manual real-browser testing (real typing, real native selection) during this investigation, and by the user's own independent testing. Full suites: core 699/699 (was 694), react 130/130 (unchanged), lint clean.

## Related/similar issues

- [list-partial-delete-removes-whole-list](list-partial-delete-removes-whole-list.md) - the list-specific instance of "partial coverage silently promoted to whole-node deletion," found and fixed earlier; this bug is the same failure shape in the more fundamental plain-paragraph case, and was not caught by that fix since it lives in a different layer (`deleteRange`'s top-level routing, not the list-item scope resolver).
- [multi-block-delete-fails-for-list-quote-code](multi-block-delete-fails-for-list-quote-code.md) - introduced the `structuralDeletionPlan`/`queueRangeDeletion` split this bug lived in; that fix correctly added structural handling for cases `queueRangeDeletion` couldn't cover, but the routing condition that decides *which* cases those are was too broad from the start.
