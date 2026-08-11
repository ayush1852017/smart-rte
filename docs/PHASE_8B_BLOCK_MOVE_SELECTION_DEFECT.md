Canonical flag confirmed: every reproduction and regression below uses `?canonicalAuthority=1`; the retained/legacy surface was used only for the comparison checks.

# Phase 8b block-move selection defect

## Result

The defect was real and had one root cause for the stale-caret symptoms. The
`moveNode` operation and its transaction-map path remapping were correct, but
the canonical renderer sometimes replaced a DOM element that had already been
moved into its new position. Replacing that element detached the browser's
native range from the model node. The model then held the moved block's
selection while the browser held a range in a detached/old text node.

The fix is in the renderer, not in the command or selection-map algorithm: a
non-text child already at the target index is reconciled by its stable
`data-smart-id`, and is diffed in place rather than recreated.

No feature flag was promoted and no rollback bridge was deleted.

## Group 1 — stale caret/selection after a move

### Reproduction

The user-facing symptoms were reproduced at the renderer level with three
top-level paragraphs. After moving the third paragraph before the second,
`renderer.mapping.nodeToDom("p1")` changed identity before the fix even though
the model selection had correctly remapped from `[1]` to `[2]`. The native
selection consequently referred to the old text node. This is the concrete
mechanism behind the reported caret jump, focus loss, wrong visible caret, and
subsequent edit-target drift.

The product regressions now exercise the same path under the canonical flag:

- `packages/react/e2e/canonical-authority.spec.ts:981-1028` moves a block and
  types immediately, asserting that the model owner and native owner are the
  same stable block ID.
- `packages/react/e2e/canonical-authority.spec.ts:1038-1075` repeats
  down/up/down/up moves with a delayed `selectionchange` opportunity and
  asserts owner identity after every move.

### Root cause

The shared structural command was not the cause. `moveContiguousSiblings` in
`packages/core/src/foundation/structural/move.ts:8-36` emits one `moveNode`
operation using stable IDs. `block.move` delegates to it at
`packages/core/src/foundation/block/commands.ts:197-198`, and
`list.move` delegates to the same implementation at
`packages/core/src/foundation/list/commands.ts:297-299`.

The model mapping was also correct: `mapPosThroughOperation` handles the
source subtree and the remove/insert case at
`packages/core/src/foundation/operations.ts:350-356`. The product runtime
maps the selection and commits it in one transaction at
`packages/react/src/canonicalEditorRuntime.ts:259-308`, then renders the new
state through the subscription at `:195-199`.

The actual bug was positional DOM diffing in
`packages/core/src/foundation/surface/renderer.ts:363-425`. For an old sibling
order `[p0,p1,p2]` and a new order `[p0,p2,p1]`, the first insertion moved the
existing `p2` DOM node. At the next index the renderer saw `p1` at the target
index but still used the old positional model child (`p2`) as `old`, then
created a replacement `p1`. That replacement discarded the live text node and
its native range.

### Fix

`renderer.ts:374-385` now checks the target DOM element's stable node ID. When
it already matches `next.id`, the renderer uses the corresponding model node
from `modelById` and diffs that DOM subtree in place. This preserves both moved
DOM identities and the native caret; it does not special-case blocks or patch
the visible selection after the fact.

## Group 2 — wrong/duplicated typing after a move

### Reproduction and relationship

The exact duplicate-character symptom was reported manually but did not occur
deterministically in the focused browser harness after a single move. The
underlying stale native-range condition did reproduce in the renderer test,
which is sufficient to explain how typing could be delivered to an obsolete
DOM target while the canonical input path used the current model selection.

Groups 1 and 2 therefore share the same cause: detached/recreated moved DOM
nodes, not a second insert operation, stored-mark bug, or history-coalescence
bug. The regression tests make the user-visible invariant explicit:

- `canonical-authority.spec.ts:981-1028` types immediately after a move and
  asserts the marker appears exactly once in the moved block.
- `canonical-authority.spec.ts:1038-1075` types after four repeated moves and
  asserts one occurrence in the selected stable-ID owner.

Both pass in all three browsers. The report does not claim that the historical
manual duplication was independently reproduced byte-for-byte; it claims the
detached-range cause is fixed and the one-insertion invariant is now tested.

## Group 3 — apparent/order changes after repeated moves

### Reproduction and result

The actual document order was inspected through the canonical model after each
move, rather than inferred from the rendered order. The repeated regression at
`canonical-authority.spec.ts:1038-1075` asserts the selected stable ID remains
the owner while applying down/up/down/up. The model order changes exactly one
contiguous-sibling step at a time and returns to its expected order.

The lower-level algebra test at
`packages/core/src/foundation/phase2_5.test.ts:93-116` also asserts
`[p0,p1,p2]` → `[p0,p2,p1]` and the corresponding list-item reorder. No
independent ordering defect was found. Group 3 was a downstream presentation/
caret confusion, not a second move algorithm bug.

## `list.move` comparison

`list.move` uses the same `moveContiguousSiblings` implementation and therefore
shared the renderer failure mode. The model map test at
`phase2_5.test.ts:103-115` verifies a list-item caret maps from the old
paragraph path to the moved subtree. The product test at
`canonical-authority.spec.ts:1092-1117` moves a list item, verifies the
reordered item IDs and model/native owner IDs, then types once; it passes in
Chromium, Firefox, and WebKit.

The initial attempt to test block Up/Down on a paragraph inside a list was
discarded because that is intentionally a no-op: list items use the separate
`list.move`/“Move item” route. No test was removed from the committed suite;
that temporary, invalid case never represented a supported command.

## Retained/legacy comparison

No equivalent retained regression was found. The retained implementation moves
actual DOM nodes and explicitly reselects/focuses the result:

- `packages/react/src/components/ClassicEditor.tsx:3272-3304` selects the moved
  range and stores it after a multi-block move.
- `ClassicEditor.tsx:3307-3349` focuses the moved element after a single-target
  move.

The retained move unit coverage in `packages/core/src/legacyCommands/move.test.ts`
and the retained list movement coverage in
`packages/react/src/components/ClassicEditor.list.test.tsx` remain green. The
canonical-only failure was introduced by the subtree renderer's positional
reconciliation path; the retained path does not use that renderer.

## Regression accounting

| Suite | Before this work | After this work | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 433 passed | 51 files / **435 passed** | None; two focused tests added (`phase2_5.test.ts:93-116, 215-236`) |
| React Vitest | 43 files / 240 passed | 43 files / **240 passed** | None |
| Focused move browser regressions | Not present | **9/9 passed** (3 tests × Chromium/Firefox/WebKit) | None |
| Full Playwright suite | 252 scheduled: 247 passed / 5 skipped | **270 scheduled: 253 passed / 12 failed / 5 skipped** | None |

The full three-browser run was not green. Its 12 failures were in the
retained/canonical session replay, composition-between-atoms, list Enter, and
checklist toolbar scenarios; none was one of the move regressions. An isolated
rerun of the nine composition/list/checklist cases also failed, so those are
not being dismissed as full-suite-only flakes. The current run is therefore
reported as 253/270 passed, 12 failed, and 5 skipped rather than being called
green. The latest completed prior report recorded 247 passed and 5 skipped;
no test was removed in this work.

`pnpm --dir packages/core test`, `pnpm --dir packages/react test`, focused
three-browser Playwright regressions, `pnpm lint`, and `git diff --check` pass.

## Disposition

Groups 1 and 2 were one renderer identity/selection-projection defect and are
fixed with model/native selection regressions. Group 3 had no separate ordering
defect. `list.move` was affected by the shared renderer path and is covered.

The canonical-authority flag remains owner-controlled. Promotion and deletion
of rollback bridges remain out of scope for this fix.
