# `mapOperation` had multiple real position-arithmetic bugs, undetected because it had zero production callers

**Status:** Fixed
**Area:** core / operations.ts (`mapOperation`, `mapPosThroughOperation`)
**First reported:** 2026-08-27, found during Phase 12b-client's pre-work (§1.1: "confirm `mapOperation` actually transforms correctly against everything that exists today, not just what existed when it was written").
**Related files:** `packages/core/src/foundation/operations.ts`, `packages/core/src/foundation/collab/transform.ts` (the only production caller, added this phase), `packages/core/src/foundation/collab/rebase.property.test.ts`

## Symptom

None reported by a user - this was found proactively. `mapOperation(operation, through)` is the operational-transform primitive the Phase 8c collab-readiness gate's assertion 5 requires ("every operation implements `map(op, otherOp)`"), and its own test coverage (`foundation.test.ts`) asserted every operation type could be mapped through a fixed "through" operation *without throwing*, and that the result's `.type` was preserved - but never asserted the resulting *position* was actually correct for a realistic concurrent pairing. `grep`-ing the whole codebase found `mapOperation` had **zero production callers** anywhere before this phase - it existed purely to satisfy the gate's assertion, never actually exercised.

## Reproduction

Confirmed via seeded-PRNG TP1 (Transformation Property 1) convergence tests - apply A then (B transformed through A), and apply B then (A transformed through B), from the same base state, and assert both produce the *same* document. All four were found this way, not by inspection:

1. Two concurrent `insertNode` operations at the same parent, non-tie offsets (e.g. offsets 2 and 5 into an 8-child array) diverged depending on transform order.
2. Two concurrent `removeNode` operations targeting the *identical* node (or a `removeNode`/`replaceNode` pair at the same slot) corrupted the document - the second one's stale `.node`/`before` payload no longer matched what was actually there.
3. An `insertNode`-vs-`removeNode` pairing at a *numerically coincidental* offset (insert's gap-offset happening to equal remove's occupied-slot-offset) was initially "fixed" by conflating the two - which broke ordinary insert-vs-remove pairs that were never actually ambiguous.
4. The exact-tie bias override (added this phase for authorId-based insert ordering, see the companion doc on conflict-classification decisions) was initially applied unconditionally to every position pair, which corrupted `removeNode`'s target when transformed through a concurrent `insertNode` at a coincidentally-equal offset - `removeNode` identifies its target by node identity, not by an ordering competition, so "which one sorts first" has no meaning there.

## Root cause

`SmartOperation`'s `.pos`/`.from`/`.to` fields reuse the same `{path, offset}` shape (`SmartPos`) for at least three structurally different meanings, and `mapPosThroughOperation`/`mapOperation` are generic, type-blind position arithmetic with no way to know which convention a given `pos` follows:

- **Occupied-slot reference** (`removeNode.pos`, `replaceNode.pos`, `moveNode.from`/`.to`): "the node currently at this index."
- **Gap reference** (`insertNode.pos`): "the boundary before this index" - numerically identical to an occupied-slot offset at the same position, but referring to something different.
- **Deep/nested reference** (`insertText.pos`, `deleteText.pos`, `setNodeAttributes.pos`, etc.): a position potentially several levels below the compared path, where prefix-based containment checks (already correct in the original code) apply.

Bug 1 (sibling `insertNode` shift): `removeNode`'s branch already special-cased "same parent, greater offset -> shift", but `insertNode`'s branch only special-cased the exact-tie case, falling through to `shiftPath` for everything else - which only shifts a position *strictly deeper* than the insertion point, never a same-depth sibling.

Bug 2 (exact-match not detected): the reverse gap - `removeNode`/`replaceNode`'s "target no longer exists" detection only checked the deep-prefix case, never a same-depth sibling reference at the identical slot.

Bug 3/4: fixing bugs 1 and 2 by adding same-depth-equal-offset checks *inside* the shared, type-blind `mapPosThroughOperation` was itself wrong, because it can't distinguish which convention `pos` follows - a coincidental offset match between an occupied-slot reference and a gap reference (or a text-offset from an unrelated `insertText`) is not a real "same target."

## Fix

- **Bug 1**: `mapPosThroughOperation`'s `insertNode` branch gained the missing same-parent, greater-offset case, mirroring `removeNode`'s existing pattern exactly.
- **Bug 2**: relocated to `mapOperation` itself (not `mapPosThroughOperation`), scoped precisely to `removeNode`/`replaceNode` vs. `removeNode`/`replaceNode` at the identical slot - the one call site that actually knows both operations' real types, rather than the shared, type-blind position mapper.
- **Bug 3/4**: `mapOperation` gained an optional `tieBreakBias` parameter, but its default-overriding behavior is restricted to `isGenuineTie = operation.type === through.type && (operation.type === "insertNode" || operation.type === "insertText")` - every other pairing always uses the original hardcoded bias (1), regardless of authorship, since only a same-kind insertion race is a genuine ordering competition.

## Regression coverage

`packages/core/src/foundation/collab/rebase.property.test.ts`: 1,000-case seeded sweeps (seeds `0xC0FFEE`, `0x5EED7EA`) covering `insertNode`/`removeNode`/`moveNode` and `insertText`/`deleteText` pairs, asserting exact TP1 convergence (not just "doesn't throw"). `packages/core/src/foundation/collab/dispatch-rebase.test.ts` exercises the same fixes through the real `FoundationEditor.dispatch` integration point, not just the pure function. Full core suite: 714/714 (was 704 before this phase), zero regressions to any pre-existing test (`mapOperation` had no other callers to regress).

## Related/similar issues

- [gate13-table-normalization-differences](gate13-table-normalization-differences.md) - a different instance of "the gate's own coverage test didn't assert what it looked like it asserted."
- The companion conflict-classification decisions (moveNode-vs-structural, merge-orphan-vs-concurrent-edit, overlapping deleteText) found during the same investigation are documented separately - those are deliberate scope decisions about what `mapOperation` should *refuse* to auto-resolve, not arithmetic bugs in what it *does* resolve.
