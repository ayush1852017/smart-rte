import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import type { SmartDocument, SmartOperation, SmartPos, SmartRange } from "../types.js";
import type { PositionLookup } from "../scope/types.js";
import type { AnnotationRange, MergeNodeOperation, MergeOrphanPolicy, SplitNodeOperation } from "./types.js";

const samePath = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const resolveEndpoint = (id: string, offset: number | undefined, side: "from" | "to", positions: PositionLookup): SmartPos | null => {
  if (offset === undefined) {
    const outer = positions.rangeOf(id);
    return outer ? outer[side] : null;
  }
  const resolved = positions.positionOf(id);
  if (!resolved) return null;
  return { path: [...resolved.pos.path, resolved.pos.offset], offset };
};

/**
 * Resolves an AnnotationRange against the current document. For every
 * operation type except splitNode/mergeNode, node identity survives
 * unchanged (move: the id follows the node; insert/remove/text/marks: never
 * touch node ids; setNodeType: id explicitly preserved), so this alone is
 * enough to track a range through most edits - PositionLookup's `positionOf`
 * resolves it fresh each call. Returns null once an anchor id no longer
 * exists (removed, or retired by a merge with no rebase applied).
 */
export const resolveAnnotationRange = (range: AnnotationRange, positions: PositionLookup): SmartRange | null => {
  const from = resolveEndpoint(range.startId, range.startOffset, "from", positions);
  const to = resolveEndpoint(range.endId, range.endOffset, "to", positions);
  return from && to ? { from, to } : null;
};

const splitTargetPath = (operation: SplitNodeOperation): number[] =>
  operation.pos.path.slice(0, operation.pos.path.length - operation.depth);

/**
 * Split keeps the pre-split id on the left half and mints `newId` for the
 * right half. An endpoint whose offset lands at or past the split point
 * moved into the right half - its id must be rewritten, or it would keep
 * resolving (via `positionOf`) to the left half's now-unrelated content,
 * silently pointing at the wrong node instead of failing loudly. An
 * endpoint anchored to a different node entirely, or one whose offset is
 * undefined (whole-node anchor, not yet split-aware), passes through
 * unchanged.
 */
const rebaseEndpointThroughSplit = (
  id: string,
  offset: number | undefined,
  operation: SplitNodeOperation,
  positions: PositionLookup,
): { id: string; offset?: number } => {
  if (offset === undefined) return { id, offset };
  const resolved = positions.positionOf(id);
  if (!resolved) return { id, offset };
  const path = [...resolved.pos.path, resolved.pos.offset];
  if (!samePath(path, splitTargetPath(operation))) return { id, offset };
  if (offset < operation.pos.offset) return { id, offset };
  return { id: operation.newId, offset: offset - operation.pos.offset };
};

const rebaseThroughSplit = (range: AnnotationRange, operation: SplitNodeOperation, positions: PositionLookup): AnnotationRange => {
  const start = rebaseEndpointThroughSplit(range.startId, range.startOffset, operation, positions);
  const end = rebaseEndpointThroughSplit(range.endId, range.endOffset, operation, positions);
  return { startId: start.id, startOffset: start.offset, endId: end.id, endOffset: end.offset };
};

const rebaseThroughMerge = (
  range: AnnotationRange,
  operation: MergeNodeOperation,
  positions: PositionLookup,
  onOrphan: MergeOrphanPolicy,
): AnnotationRange | null => {
  if (range.startId !== operation.retiredId && range.endId !== operation.retiredId) return range;
  return onOrphan(range, operation, positions);
};

/**
 * An endpoint anchored to a retired id snaps to its survivor's whole-node
 * span (offset cleared, not remapped) - the survivor is a different node
 * whose content was assembled by concatenating multiple sources in an
 * order this generic mechanism has no way to know (e.g. `mergeItems`'
 * `mergeOwners` combines two paragraphs' text in an order that depends on
 * merge direction), so a stale offset into the retired node's own text
 * cannot be reliably remapped into the merged text - a wrong-but-
 * plausible-looking offset would be worse than an honest whole-node
 * anchor. Unlike the mergeNode case above, there is no caller-supplied
 * policy here: `mergedInto`/`retiredInto` are opt-in fields a command
 * populates only when it knows exactly where the content went, so
 * snapping is the unambiguous, mechanical consequence of the field's
 * presence, not a product decision requiring caller input - the actual
 * product decision already happened at the command layer, by choosing to
 * populate the field at all instead of leaving the operation as a plain,
 * policy-free removeNode/replaceNode.
 */
const snapEndpoint = (id: string, offset: number | undefined, retiredId: string, survivorId: string): { id: string; offset?: number } =>
  id === retiredId ? { id: survivorId } : { id, offset };

// Preserves reference identity when neither endpoint actually matches
// retiredId - a consumer rebasing many ranges through the same operation
// (see comments/rebase.ts) relies on `===` to cheaply tell which ones
// actually changed, e.g. to avoid re-persisting or re-rendering untouched
// threads.
const rebaseThroughMergedRemove = (range: AnnotationRange, retiredId: string, survivorId: string): AnnotationRange => {
  if (range.startId !== retiredId && range.endId !== retiredId) return range;
  const start = snapEndpoint(range.startId, range.startOffset, retiredId, survivorId);
  const end = snapEndpoint(range.endId, range.endOffset, retiredId, survivorId);
  return { startId: start.id, startOffset: start.offset, endId: end.id, endOffset: end.offset };
};

const rebaseThroughRetiredReplace = (
  range: AnnotationRange,
  retirements: readonly { readonly retiredId: string; readonly survivorId: string }[],
): AnnotationRange =>
  retirements.reduce((current, { retiredId, survivorId }) => rebaseThroughMergedRemove(current, retiredId, survivorId), range);

/**
 * Rebases an AnnotationRange through a single operation. Every operation
 * type other than split/merge/an-explicitly-marked-merge-shaped-removeNode-
 * or-replaceNode is a no-op here - node identity already survives them, so
 * the range's stored ids stay valid and `resolveAnnotationRange` picks up
 * the new position on its own next call. `positions` must resolve against
 * the document as it existed immediately before `operation` is applied.
 */
export const rebaseAnnotationRange = (
  range: AnnotationRange,
  operation: SmartOperation,
  positions: PositionLookup,
  onOrphan: MergeOrphanPolicy,
): AnnotationRange | null => {
  if (operation.type === "splitNode") return rebaseThroughSplit(range, operation, positions);
  if (operation.type === "mergeNode") return rebaseThroughMerge(range, operation, positions, onOrphan);
  if (operation.type === "removeNode" && operation.mergedInto && !isTextNode(operation.node)) {
    return rebaseThroughMergedRemove(range, operation.node.id, operation.mergedInto);
  }
  if (operation.type === "replaceNode" && operation.retiredInto?.length) return rebaseThroughRetiredReplace(range, operation.retiredInto);
  return range;
};

/**
 * Folds `rebaseAnnotationRange` over a sequence of operations, e.g. every
 * operation in one transaction, in order. Each step's `positions` must
 * resolve against the document as it existed immediately before that step's
 * operation - the caller (which is already applying the operations to
 * advance the document) is in the natural position to supply this.
 */
export const rebaseAnnotationRangeThroughOperations = (
  range: AnnotationRange,
  steps: readonly { readonly operation: SmartOperation; readonly positions: PositionLookup }[],
  onOrphan: MergeOrphanPolicy,
): AnnotationRange | null => {
  let current: AnnotationRange | null = range;
  for (const step of steps) {
    if (!current) return null;
    current = rebaseAnnotationRange(current, step.operation, step.positions, onOrphan);
  }
  return current;
};

/**
 * Reference `MergeOrphanPolicy`: snap to the surviving node rather than
 * drop (Phase 12a's decision - a comment on content that got merged into
 * something else is still relevant to that content's new home; silently
 * vanishing it loses data with no recovery path). Only applicable to a
 * real `mergeNode` operation (`input.ts`'s cross-block Backspace/Delete
 * text-merge) - unlike `mergedInto`/`retiredInto` above, `mergeNode`'s own
 * shape has no explicit survivor field, so deriving it needs the actual
 * document tree (the sibling immediately preceding the merge point,
 * matching how `input.ts`'s `queueRangeDeletion` constructs the
 * operation: `retiredId` is the right/consumed block, the left/absorbing
 * block sits one offset earlier at the same parent). `positions` alone
 * (an id-keyed lookup) can't answer "what's at this path" in the reverse
 * direction, so this needs `document` explicitly, unlike every other
 * function in this file.
 *
 * Table-cell-merge and list-item-merge don't need this - they always
 * populate `mergedInto`/`retiredInto` themselves, so `rebaseAnnotationRange`
 * snaps them unconditionally with no caller policy involved at all.
 */
export const defaultMergeOrphanPolicy = (document: SmartDocument): MergeOrphanPolicy => (range, operation) => {
  const parent = nodeAtPath(document, operation.pos.path);
  if (!parent || isTextNode(parent) || !parent.children) return null;
  const survivor = parent.children[operation.pos.offset - 1];
  if (!survivor || isTextNode(survivor)) return null;
  return rebaseThroughMergedRemove(range, operation.retiredId, survivor.id);
};
