# Several concurrent-edit shapes silently corrupted state or crashed under rebase; now explicit conflicts

**Status:** Fixed
**Area:** core / collab (new module, Phase 12b-client)
**First reported:** 2026-08-27, found while building Phase 12b-client's rebase-and-reapply path (`docs/bugs/mapoperation-position-arithmetic-gaps.md`'s companion investigation).
**Related files:** `packages/core/src/foundation/collab/transform.ts`, `packages/core/src/foundation/collab/rebase.ts`, `packages/core/src/foundation/collab/rebase.property.test.ts`

## Symptom

None reported by a user - found proactively via TP1 (Transformation Property 1) seeded-PRNG convergence testing while building the rebase engine this phase's spec calls for. Several concurrent-edit shapes either silently dropped a user's edit with no signal it happened, corrupted the resulting document, or threw a low-level payload-mismatch error instead of a meaningful one.

## Reproduction

All four found via property tests asserting exact document equality between the two possible transform orders, not just "no exception":

1. **Concurrent `moveNode` vs. any structural operation sharing the same parent array** - even a `moveNode` of one node and a `removeNode` of a completely *unrelated* node in the same array produced different final orderings depending on transform direction (moving "to offset 6" means something different depending on whether a concurrent removal elsewhere in the array is accounted for first).
2. **Concurrent edit to content a `removeNode.mergedInto`/`replaceNode.retiredInto` operation absorbs** (e.g. a real `mergeTableCellsCommand` merge, concurrent with someone typing into the cell being absorbed) - `mapOperation` ignores these fields entirely by design (they were built in Phase 12a only for the separate, ID-keyed `rebaseAnnotationRange` mechanism), so the concurrent edit was silently dropped with no signal.
3. **A concurrent insertion landing inside a `deleteText`'s span** - `deleteText` carries the exact text it expects to remove as a self-check; a concurrent insert makes that payload stale, throwing a low-level "payload does not match" error instead of a meaningful conflict.
4. **Two overlapping (but not identical) `deleteText` ranges** - same staleness problem as (3), for delete-vs-delete instead of insert-vs-delete.

## Root cause

`mapOperation` is - correctly - a narrow, pure position-transform primitive with no document access. All four shapes above require information it structurally cannot have: `moveNode.to`'s "relative to the array after this move's own source is removed" convention has no well-defined meaning once a *different* concurrent structural change also touches that array; auto-redirecting an operation (not just an annotation-range endpoint) to a merge's survivor risks producing a `before`/`text` payload that no longer matches the survivor's actual content; and neither insert-into-delete nor delete-vs-delete overlap can be resolved without deciding *which* author's intent wins, which `mapOperation` has no basis for deciding.

## Fix

A new `transformOperation` wrapper (`collab/transform.ts`) classifies these shapes *before* calling `mapOperation`, returning an explicit `{kind: "conflict", reason}` instead of ever reaching the plain, unaware transform:

- Any `moveNode` vs. any `insertNode`/`removeNode`/`replaceNode`/`moveNode` sharing a parent array with its `from` or `to` → conflict. Deliberately not narrowed to same-node-only cases (an earlier, narrower version of this check let two concurrent moves of *different* nodes fall through, which still corrupted the result).
- Any operation touching (in either direction - operation-is-the-merge or through-is-the-merge) the subtree a `mergedInto`/`retiredInto`-carrying operation absorbs → conflict.
- A `deleteText`/`insertText` pair where the insert lands strictly inside the delete's span → conflict. Boundary inserts (exactly at the delete's start/end) are unambiguous and excluded.
- Two `deleteText` ranges that overlap → conflict, *except* when they're identical (same offset, same text) - a plain duplicate delete has no real ambiguity and is dropped as an ordinary no-op instead.

`rebaseTransaction` (`collab/rebase.ts`) treats any operation-level conflict as rejecting the *whole* transaction atomically (matching `applyTransactionAtomic`'s own all-or-nothing semantics) rather than partially applying it. `FoundationEditor.dispatch` surfaces this as `RebaseConflictError`, distinct from the retention-window `ResyncRequiredError`.

This is a deliberate, disclosed scope decision (2026-08-27), not a temporary gap: fixing `moveNode` in general means redefining `.to`'s semantics for every existing caller (table row/column reorder, list item reorder), which is out of this phase's scope. A future pass could narrow these conflict shapes with more specific handling; until then, TP1's guarantee for `moveNode` and for merge-absorbed/overlapping-delete content is honestly scoped to "conflicts explicitly, never silently corrupts," not "always transforms."

## Regression coverage

`packages/core/src/foundation/collab/rebase.property.test.ts`: the generic 1,000-case sweep exercises moveNode conflicts as a matter of course (asserted to occur, not just tolerated); a dedicated test merges two real table cells via `mergeTableCellsCommand` and confirms a concurrent edit to the absorbed cell conflicts in both transform directions; insert-into-delete and delete-vs-delete overlap are exercised by the insertText/deleteText sweep once construction bugs in the test's own random generator (producing `deleteText.text` values that didn't match the actual document content) were fixed. Full core suite: 714/714.

## Related/similar issues

- [mapoperation-position-arithmetic-gaps](mapoperation-position-arithmetic-gaps.md) - the companion investigation's arithmetic-bug half; this file is the "deliberately refuses to guess" half.
- [comment-lost-on-cross-block-backspace-merge](comment-lost-on-cross-block-backspace-merge.md) and the broader Phase 12a merge-orphan work - the *single-user, sequential* version of the same "does a merge correctly account for something anchored to the content it absorbs" question; this file is the *concurrent* version, which turned out to need a different answer (conflict, not snap-to-survivor) because operations, unlike annotation ranges, can't be safely redirected without document access to validate the result.
