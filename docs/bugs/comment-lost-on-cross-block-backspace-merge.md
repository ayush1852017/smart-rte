# Comment thread silently lost when its paragraph is merged via plain Backspace

**Status:** Fixed
**Area:** annotations / comments / surface input (`packages/core/src/foundation/surface/input.ts`)
**First reported:** 2026-08-24 (found via Phase 12a's own comment-anchor-survival e2e verification, not an external report)
**Related files:** none prior — first comments-specific bug

## Symptom

A comment thread anchored (via `AnnotationRange`) to text inside a paragraph stopped resolving - its highlight/badge disappeared entirely - the moment that paragraph was merged into its preceding sibling by pressing Backspace at the very start of the paragraph (a collapsed caret, not a selection). The thread's data was not deleted, but `resolveAnnotationRange` returned `null` for it going forward, which is indistinguishable from "anchored to content that's really gone" - the thread was effectively lost from the user's perspective.

## Reproduction

Playwright e2e (`packages/react/e2e/comments.spec.ts`, "comments on a real cross-block Backspace merge..."): two paragraphs, comment on a word in the second paragraph, place the caret at the very start of the second paragraph, press Backspace once (real `deleteContentBackward` beforeinput, not a synthetic operation). Before the fix: the comment marker (`[data-srte-comment-badge]`) vanished immediately after the merge. Also reproducible directly at the core layer (`phase2_5.test.ts`, new test) by dispatching `deleteContentBackward` via `beforeinput` against a two-paragraph `FoundationEditor` and inspecting the committed transaction's operations.

Not reproducible via `mergeTableCellsCommand` or `mergeItems` (list-item merge) - those two were already covered by Phase 12a §2.1a/b's `mergedInto`/`retiredInto` fields and have their own regression tests in `table.test.ts`/`input.test.ts` (list).

## Root cause

Phase 12a §1.1's pre-work audit concluded `mergeNode` (the `SmartOperation` variant `MergeOrphanPolicy` was originally built for) is emitted from exactly one place, `input.ts`'s `queueRangeDeletion`, and that table-cell-merge/list-item-merge were the only other real "merge" paths, both fixed via the new `mergedInto`/`retiredInto` optional fields. That audit was incomplete: a **collapsed caret** Backspace/Delete at a block boundary does not go through `queueRangeDeletion` at all - it goes through a separate function, `deleteAcrossBlock` (`surface/input.ts`, called from `deleteByInputType` for `deleteContentBackward`/`deleteContentForward`). For a non-empty adjacent block, `deleteAcrossBlock` builds its own `replaceNode` (surviving owner, absorbing the other's children) + `removeNode` (removed owner) pair directly - the exact same shape as the table/list merges, but the `removeNode` never carried `mergedInto`. This is the single most common real "merge two paragraphs" interaction (plain Backspace at a paragraph start), and it had no orphan-policy lever at all.

## Fix

`surface/input.ts`'s `deleteAcrossBlock`, the `removeNode` operation for `removedOwner` (previously `{ type: "removeNode", pos: removedPosition.pos, node: removedOwner }`) now sets `mergedInto: survivingOwner.id` - the survivor is already known explicitly at this call site, so this is a mechanical, unconditional marking exactly like `mergeTableCellsCommand`/`mergeItems`. No changes needed in `annotations/range.ts` - the existing `mergedInto` handling in `rebaseAnnotationRange` (Phase 12a §2.1a) already covers it once the field is set.

## Regression coverage

- `packages/core/src/foundation/phase2_5.test.ts`: "marks the removed paragraph's removeNode as merged into the surviving paragraph on a real cross-block Backspace (Phase 12a comment-anchor-survival)" - dispatches a real `deleteContentBackward` beforeinput and asserts the committed `removeNode` operation carries `mergedInto`.
- `packages/react/e2e/comments.spec.ts`: full real-browser lifecycle (create comment → real Backspace merge → thread still resolves and lists its content) across chromium/firefox/webkit, run 3× for stability.

## Related/similar issues

None yet on file - first comments-specific bug. Conceptually the same class of gap as the one §1.1 already found and fixed for table-cell-merge/list-item-merge (a `replaceNode`/`removeNode`-shaped merge with no `mergeNode` operation and therefore no default orphan handling); this is the third such site fixed.

**Known, explicitly unaudited gap:** a full sweep of every `removeNode`/`replaceNode` construction site in the codebase (`grep -rn 'type: "removeNode"\|type: "replaceNode"'` under `packages/core/src/foundation`) turns up ~40 call sites well beyond the three fixed so far - notably clipboard paste/cut content-splicing (`clipboard/insertion.ts`, `clipboard/transfer.ts`, which stitch prefix/suffix content across a removed node much like `mergeItems` does) and list/block wrap-unwrap operations (`list/commands.ts`, `block/commands.ts`). These were **not** individually triaged for whether they are merge-shaped (content absorbed elsewhere, needs `mergedInto`) versus genuinely deletion-shaped (content discarded, no survivor to snap to) - doing so was out of scope for this fix, which was driven by what the comments e2e test actually caught, not a full-surface audit. A comment anchored to content touched by one of these paths may still silently fail to resolve after such an edit. Re-triage if/when a similar report surfaces for paste/cut or list/block wrapping specifically.
