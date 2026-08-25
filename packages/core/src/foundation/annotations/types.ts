import type { SmartOperation } from "../types.js";
import type { PositionLookup } from "../scope/types.js";

/**
 * A range anchored to node ids rather than a path/offset, so it survives
 * structural edits elsewhere in the document without being carried through
 * every transaction. Resolve it on demand via `resolveAnnotationRange`.
 *
 * An absent offset anchors to the whole node (its outer span) rather than a
 * text position inside it. There is deliberately no `kind` discriminant yet
 * (text range vs. whole-node anchor) - that is left for whichever phase
 * first needs to distinguish them, so this primitive does not have to be
 * retrofitted once real consumers exist.
 */
export interface AnnotationRange {
  readonly startId: string;
  readonly startOffset?: number;
  readonly endId: string;
  readonly endOffset?: number;
}

export type SplitNodeOperation = Extract<SmartOperation, { type: "splitNode" }>;
export type MergeNodeOperation = Extract<SmartOperation, { type: "mergeNode" }>;

/**
 * Called when a merge retires a node id an AnnotationRange endpoint was
 * anchored to. foundation/ has no opinion on whether the range should be
 * dropped, snapped into the surviving node, or something else - comments and
 * suggestions plausibly want different answers - so that decision is left
 * entirely to the caller rather than baked into the primitive.
 */
export type MergeOrphanPolicy = (
  range: AnnotationRange,
  operation: MergeNodeOperation,
  positions: PositionLookup,
) => AnnotationRange | null;
