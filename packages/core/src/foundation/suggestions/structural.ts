import { createNodeId } from "../identity.js";
import { applyOperation } from "../operations.js";
import { createScopeIndex } from "../scope/resolveScope.js";
import { defaultMergeOrphanPolicy, rebaseAnnotationRange, resolveAnnotationRange } from "../annotations/range.js";
import type { AnnotationRange, MergeOrphanPolicy } from "../annotations/types.js";
import type { PositionLookup } from "../scope/types.js";
import type { SmartDocument, SmartOperation, SmartSchema, SmartTransaction } from "../types.js";

/**
 * A proposed removal of a whole structural node (a paragraph, list item,
 * table row, ...) - the AnnotationRange half of Phase 12a §2.3's hybrid
 * architecture (2026-08-24 decision). Unlike an inline suggestion (a mark
 * on real text, see inline.ts), the node stays exactly as it is in the
 * live document until accepted - there is no equivalent "tag the node and
 * insert it for real" mechanism for a *new* structural node yet (see the
 * module-level limitation note below); only proposed removal is supported.
 *
 * `range` always anchors both endpoints to the same node id (a whole-node
 * span, offsets undefined) - the exact same shape CommentMarkers/
 * resolveAnnotationRange already render and rebase correctly for whole-
 * node anchors.
 */
export interface StructuralSuggestion {
  readonly id: string;
  readonly authorId: string;
  readonly kind: "removeNode";
  readonly range: AnnotationRange;
  readonly createdAt: number;
}

export const structuralSuggestionFromNode = (
  nodeId: string,
  authorId: string,
  opts: { readonly id?: string; readonly createdAt?: number } = {},
): StructuralSuggestion => ({
  id: opts.id || createNodeId(),
  authorId,
  kind: "removeNode",
  range: { startId: nodeId, endId: nodeId },
  createdAt: opts.createdAt ?? Date.now(),
});

/** Accept: actually removes the node. No-op (empty operations) if it no longer resolves - already gone, nothing to do. */
export const acceptStructuralSuggestionCommand = (
  document: SmartDocument,
  suggestion: StructuralSuggestion,
  positions: PositionLookup,
): SmartOperation[] => {
  const resolvedRange = resolveAnnotationRange(suggestion.range, positions);
  if (!resolvedRange) return [];
  const resolved = positions.positionOf(suggestion.range.startId);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node) return [];
  return [{ type: "removeNode", pos: resolved.pos, node }];
};

// Reject never touches the document - a proposed removal never removed
// anything, so discarding the StructuralSuggestion record itself (a
// caller/storage concern, not a core one) is the entire "reject" action.

/**
 * Replays a transaction's operations to keep every suggestion's range
 * anchored, exactly mirroring comments/rebase.ts's
 * rebaseCommentThreadsThroughTransaction (same reasoning: a fresh
 * PositionLookup per operation, reference-identity preserved for untouched
 * suggestions). Kept as a separate, structurally-parallel implementation
 * rather than sharing code with comments/rebase.ts, to avoid touching that
 * already-shipped, already-tested module for this.
 */
export const rebaseStructuralSuggestionsThroughTransaction = (
  suggestions: readonly StructuralSuggestion[],
  beforeDocument: SmartDocument,
  transaction: SmartTransaction,
  schema: SmartSchema,
): readonly StructuralSuggestion[] => {
  if (!suggestions.length || !transaction.operations.length) return suggestions;
  let runningDocument = beforeDocument;
  let ranges: readonly AnnotationRange[] = suggestions.map((suggestion) => suggestion.range);
  for (const operation of transaction.operations) {
    const positions = createScopeIndex().positions(runningDocument, schema);
    const onOrphan: MergeOrphanPolicy = (range, mergeOp, lookup) => defaultMergeOrphanPolicy(runningDocument)(range, mergeOp, lookup) ?? range;
    ranges = ranges.map((range) => rebaseAnnotationRange(range, operation, positions, onOrphan) ?? range);
    runningDocument = applyOperation(runningDocument, operation);
  }
  return suggestions.map((suggestion, index) => ranges[index] === suggestion.range ? suggestion : { ...suggestion, range: ranges[index] });
};
