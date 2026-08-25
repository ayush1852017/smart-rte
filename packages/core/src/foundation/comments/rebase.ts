import { applyOperation } from "../operations.js";
import { createScopeIndex } from "../scope/resolveScope.js";
import type { SmartDocument, SmartSchema, SmartTransaction } from "../types.js";
import { defaultMergeOrphanPolicy, rebaseAnnotationRange } from "../annotations/range.js";
import type { AnnotationRange, MergeOrphanPolicy } from "../annotations/types.js";
import type { CommentThread } from "./types.js";

/**
 * Comments must never silently disappear from a merge the way a caller
 * might reasonably choose for some other annotation consumer - a lost
 * comment is lost user-authored text, not just a lost position. Tries the
 * standard snap-to-survivor policy first; if there's genuinely no
 * preceding sibling to snap to (a real edge case `defaultMergeOrphanPolicy`
 * itself can return null for), keeps the range's ids exactly as they were
 * rather than dropping it. That range will simply fail to resolve once
 * the retired id is gone from the document - the same "orphaned, not
 * lost" state a `removeNode` with no `mergedInto` already produces
 * naturally - so the thread's data survives and the UI can detect and
 * surface "comment on deleted content" by the standard resolve-and-check
 * pattern, not a special stored flag.
 */
export const neverOrphanCommentPolicy = (document: SmartDocument): MergeOrphanPolicy => (range, operation, positions) =>
  defaultMergeOrphanPolicy(document)(range, operation, positions) ?? range;

/**
 * Rebases every thread's range through one committed transaction, in
 * operation order. `rebaseAnnotationRange`/`rebaseAnnotationRangeThroughOperations`
 * need a fresh `PositionLookup` resolved against the document as it
 * existed immediately before each individual operation (not the whole
 * transaction) - since a caller subscribing to a runtime's transaction
 * stream only receives the transaction after it has fully committed, this
 * reconstructs those intermediate states itself by replaying operations
 * one at a time against a running copy, starting from `beforeDocument`
 * (whatever the document was immediately before this transaction, i.e.
 * exactly what the caller already had from the previous change event).
 */
export const rebaseCommentThreadsThroughTransaction = (
  threads: readonly CommentThread[],
  beforeDocument: SmartDocument,
  transaction: SmartTransaction,
  schema: SmartSchema,
): readonly CommentThread[] => {
  if (!threads.length || !transaction.operations.length) return threads;
  let runningDocument = beforeDocument;
  let ranges: readonly AnnotationRange[] = threads.map((thread) => thread.range);
  for (const operation of transaction.operations) {
    const positions = createScopeIndex().positions(runningDocument, schema);
    const onOrphan = neverOrphanCommentPolicy(runningDocument);
    ranges = ranges.map((range) => rebaseAnnotationRange(range, operation, positions, onOrphan) ?? range);
    runningDocument = applyOperation(runningDocument, operation);
  }
  return threads.map((thread, index) => ranges[index] === thread.range ? thread : { ...thread, range: ranges[index] });
};
