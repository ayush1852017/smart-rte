# Block/list/table Move Up/Down: stale caret, focus loss, and duplicated typing after reorder

**Status:** Fixed (verified generalizes to list items and table rows/columns, not just top-level blocks)
**Area:** block / list / table / selection / renderer
**First reported:** unknown — backfilled from `docs/PHASE_8B_BLOCK_MOVE_SELECTION_DEFECT.md`
**Related files:** `docs/PHASE_8B_BLOCK_MOVE_SELECTION_DEFECT.md`, `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`

## Symptom

After moving a block (Move Up/Down), users reported caret jump, focus loss, and subsequent typing landing in the wrong place or duplicating characters. A secondary concern (investigated, not confirmed) was whether repeated moves could corrupt actual document order, not just visual/caret state.

## Reproduction

- **Caret/selection identity**: reproduced at the renderer level with three top-level paragraphs `[p0,p1,p2]` — move the third paragraph before the second → new order `[p0,p2,p1]`. `renderer.mapping.nodeToDom("p1")` changed DOM identity even though the model selection correctly remapped its path.
- **Duplicate typing**: the exact "duplicated characters" symptom did **not** reproduce deterministically in the focused browser harness after a single move. The underlying stale-native-range condition did reproduce at the renderer level, which is sufficient to explain how typing could be delivered to a detached DOM target. Re-verified more aggressively later with 12 alternating Move Down/Move Up operations plus immediate unique-token typing after every move, with no delay — no duplication observed, 3/3 browsers.
- **Document-order corruption**: investigated directly (not inferred from rendered order) after repeated moves — no separate ordering defect found. This was a presentation/caret-confusion artifact of the same renderer bug, not independent corruption.
- **Generalization to tables**: also tested table row move and column move (assert model/native owner ID equality, type into cell after move) — same underlying mechanism, no table-specific fix needed.

## Root cause

The shared structural command (`moveContiguousSiblings`), the model-level position-mapping (`mapPosThroughOperation`), and the runtime's transaction/render sequencing were all investigated first and ruled out — all correct. The actual bug was **positional DOM diffing** in the renderer (`packages/core/src/foundation/surface/renderer.ts`): for old order `[p0,p1,p2]` → new `[p0,p2,p1]`, the first insertion moved the existing `p2` DOM node; at the next index the renderer compared the DOM element now at that index against the old *positional* model child (`p2`) rather than checking whether the DOM element's own stable ID already matched the target — so it created a brand-new replacement DOM node instead of reusing the moved one, discarding the live text node and its native range.

## Fix

The renderer now checks the target DOM element's stable node ID first; if it already matches the next model node's ID, it diffs that DOM subtree in place using the corresponding model node, rather than replacing it. This preserves moved DOM identity and the native caret without any block-specific special-casing or post-hoc selection patching — which is why it generalized cleanly to list-item move and table row/column move with no additional code.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: move + type immediately (asserts model/native owner ID equal); down/up/down/up with delayed `selectionchange` (asserts owner identity after every move); 12-alternation rapid move+type stress test; table row move and column move equivalents. `packages/core/src/foundation/phase2_5.test.ts`: block and list-item move-order assertions. Retained/legacy engine was unaffected (it moves actual DOM nodes and explicitly reselects/refocuses) — no retained regression, no retained code changed.

## Related/similar issues

- [block-move-fix-regression-introduced-by-first-attempt](block-move-fix-regression-introduced-by-first-attempt.md) — the *first* implementation of this exact fix introduced new regressions (composition-between-atoms, list-Enter) before being corrected. Read that file before touching this code again.
- [list-move-on-paragraph-no-op](list-move-on-paragraph-no-op.md) — a related but distinct, confirmed-not-a-bug finding from the same investigation era (a plain paragraph inside a list intentionally doesn't respond to block-move).
