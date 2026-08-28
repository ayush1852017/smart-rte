import { mapOperation } from "../operations.js";
import { samePath } from "../positions.js";
import type { SmartOperation, SmartPos } from "../types.js";
import type { TransformResult } from "./types.js";

/** `[...pos.path, pos.offset]` - the full path to whatever slot/child `pos` addresses, for whole-node operations (insertNode/removeNode/replaceNode/setNodeAttributes/setNodeType). */
const slotPath = (pos: SmartPos): number[] => [...pos.path, pos.offset];

/** True when `pos` (a container-relative position, e.g. an insertText/deleteText/addMark endpoint) sits at-or-within the subtree rooted at `subtreeRoot`'s slot. Mirrors the removeNode-vs-descendant check already established in mapPosThroughOperation. */
const isWithinSubtree = (pos: SmartPos, subtreeRoot: SmartPos): boolean => {
  const root = slotPath(subtreeRoot);
  return samePath(pos.path.slice(0, root.length), root);
};

/** True when `pos` addresses the exact same slot as `subtreeRoot` (a whole-node operation targeting that node directly, not something inside it). */
const isExactlyAtSlot = (pos: SmartPos, subtreeRoot: SmartPos): boolean =>
  samePath(pos.path, subtreeRoot.path) && pos.offset === subtreeRoot.offset;

/**
 * The two "occupied slot" references a mergeNode operation cares about:
 * the surviving left sibling (`pos.offset - 1`) and the retired right
 * sibling (`pos` itself). `applyOperation`'s own mergeNode handling
 * validates `splitOffset === left.children.length` and that left/right are
 * structurally compatible - both checks depend on the *actual identity* of
 * whatever currently occupies these two slots, not just their positions.
 */
const mergeNodeSlots = (op: Extract<SmartOperation, { type: "mergeNode" }>): [SmartPos, SmartPos] => [
  { path: op.pos.path, offset: op.pos.offset - 1 },
  { path: op.pos.path, offset: op.pos.offset },
];

/**
 * The exact-slot reference for operation types that identify a node by
 * "parent + child index" (the same convention mergeNode's own slots use) -
 * restricted to the types where an exact offset match genuinely means "the
 * same node," which excludes insertNode (a *gap* reference, not an
 * occupied slot - two different conventions sharing the same {path,
 * offset} shape, the same distinction already established for the
 * removeNode/replaceNode exact-match fix in mapOperation) and excludes
 * splitNode/setNodeAttributes/insertText/deleteText/addMark (deeper or
 * differently-conventioned references that `mapPosThroughOperation`'s own
 * mergeNode-as-through branch already redirects safely - confirmed via a
 * property test that a splitNode targeting the exact node a concurrent
 * mergeNode retires converges correctly without needing to be flagged
 * here).
 */
const occupiedSlotsOf = (op: SmartOperation): SmartPos[] | null => {
  if (op.type === "removeNode" || op.type === "replaceNode") return [op.pos];
  if (op.type === "mergeNode") return mergeNodeSlots(op);
  // moveNode.from/.to use the same "occupied slot" convention, but any
  // moveNode paired with a mergeNode already shares a parent array (the
  // merge's own path) and is caught unconditionally by the broader moveNode
  // conflict rule above, before this function is reached - listing it here
  // too would be redundant, not incorrect.
  return null;
};

const operationTouchesSubtree = (operation: SmartOperation, subtreeRoot: SmartPos): { exact: boolean; within: boolean } => {
  if (operation.type === "insertNode" || operation.type === "removeNode" || operation.type === "replaceNode"
    || operation.type === "setNodeAttributes" || operation.type === "setNodeType"
    || operation.type === "splitNode" || operation.type === "mergeNode"
    || operation.type === "insertText" || operation.type === "deleteText") {
    return { exact: isExactlyAtSlot(operation.pos, subtreeRoot), within: isWithinSubtree(operation.pos, subtreeRoot) };
  }
  if (operation.type === "moveNode") {
    return {
      exact: isExactlyAtSlot(operation.from, subtreeRoot) || isExactlyAtSlot(operation.to, subtreeRoot),
      within: isWithinSubtree(operation.from, subtreeRoot) || isWithinSubtree(operation.to, subtreeRoot),
    };
  }
  // addMark / removeMark
  return {
    exact: false,
    within: isWithinSubtree(operation.range.from, subtreeRoot) || isWithinSubtree(operation.range.to, subtreeRoot),
  };
};

/**
 * Transforms `operation` through a single concurrent `through` operation,
 * classifying the small number of shapes this codebase's operation model
 * cannot safely auto-resolve rather than silently deferring to
 * `mapOperation`'s uniform `null` for all of them (see this module's
 * `types.ts` doc comment on `TransformResult`).
 *
 * Two conflict shapes, both decided explicitly (2026-08-27, product
 * decision) rather than attempted automatically:
 *
 * 1. **Concurrent moveNode vs. *any* structural operation touching the same
 *    parent array as its `from` or `to`.** `moveNode.to` is defined
 *    relative to "the array with this move's own source already removed"
 *    (operations.ts's applyToSession) - a convention with no well-defined
 *    composition once a concurrent structural change *also* touches that
 *    same array, even one that doesn't touch the moved node itself.
 *    Confirmed empirically via property tests, in increasing generality:
 *    two moves of *different* nodes to nearby destinations produced
 *    different final orders depending on transform direction; a move
 *    composed with a same-node remove crashed outright; and - the broadest
 *    case - a moveNode transformed through a plain removeNode of a
 *    *completely unrelated* node in the same array still diverged (moving
 *    "to offset 6" means different things depending on whether that offset
 *    is read before or after the unrelated removal is accounted for).
 *    Fixing this in general means redefining `to` for every existing
 *    moveNode caller (table row/column reorder, list item reorder) - out of
 *    scope for this phase. Flagged as a conflict for *any* concurrent
 *    structural operation (insertNode/removeNode/replaceNode/moveNode) on
 *    the same parent array, not narrowed to same-node cases only.
 * 2. **Concurrent edit to content a `removeNode.mergedInto`/
 *    `replaceNode.retiredInto` operation absorbed.** `mapOperation` already
 *    ignores these fields entirely (by design - see the SmartOperation type
 *    comment; they were built in Phase 12a only for `rebaseAnnotationRange`,
 *    a different, ID-keyed mechanism). Auto-redirecting an *operation*
 *    (rather than an annotation range's endpoint) to the survivor has its
 *    own correctness risk even for whole-node-targeting ops - e.g. a
 *    concurrent `setNodeAttributes` redirected to the survivor would carry
 *    a `before` payload captured against the *retired* node's attrs, which
 *    `applyOperation`'s strict before-check would then reject against the
 *    survivor's actual attrs. Flagged as a conflict, consistent with
 *    decision 1, rather than attempting a redirect whose correctness isn't
 *    established.
 * 3. **Concurrent mergeNode vs. anything occupying its left (survivor) or
 *    right (retired) slot** (2026-08-28, required follow-up to finding #1
 *    in mapoperation-position-arithmetic-gaps.md). `applyOperation`'s own
 *    mergeNode handling validates `splitOffset === left.children.length`
 *    and that left/right are structurally compatible - both checks depend
 *    on the actual identity of whatever occupies those two slots.
 *    `mapPosThroughOperation`'s mergeNode-as-through branch only tracks a
 *    single explicit position (`operation.pos`/`.from`/`.to`), so an
 *    ordinary sibling-index shift correctly keeps a *retiring* target
 *    reachable but has no way to notice that a node's *identity* changed
 *    underneath an *implicit* left-neighbor reference. Confirmed
 *    empirically: two mergeNode ops retiring adjacent siblings (A retires
 *    node N into its left neighbor, B retires N's *next* sibling into N)
 *    crashed in one transform direction and silently produced a different
 *    document in the other; a mergeNode composed with a concurrent
 *    `removeNode` of its own left/survivor node crashed both ways. A
 *    concurrent `splitNode` targeting the *exact* node a mergeNode retires
 *    was checked and found *not* to need this treatment - it already gets
 *    `mapPosThroughOperation`'s explicit "this position IS the retired
 *    node, redirect into the survivor" case, which correctly recomputes an
 *    in-bounds position rather than carrying a stale content-derived
 *    payload the way `mergeNode.splitOffset` does. Same reasoning as
 *    finding 1 above: not narrowed further, since fixing this generally
 *    would mean giving `mapOperation` document access it deliberately
 *    doesn't have.
 */
export const transformOperation = (
  operation: SmartOperation,
  through: SmartOperation,
  options: { tieBreakBias?: -1 | 1 } = {},
): TransformResult => {
  const structuralParentPaths = (candidate: SmartOperation): number[][] => {
    if (candidate.type === "insertNode" || candidate.type === "removeNode" || candidate.type === "replaceNode") return [candidate.pos.path];
    if (candidate.type === "moveNode") return [candidate.from.path, candidate.to.path];
    return [];
  };
  if (operation.type === "moveNode" || through.type === "moveNode") {
    const moveOperation = operation.type === "moveNode" ? operation : through.type === "moveNode" ? through : null;
    const other = moveOperation === operation ? through : operation;
    if (moveOperation) {
      const moveParents = structuralParentPaths(moveOperation);
      const otherParents = structuralParentPaths(other);
      const sharesArray = otherParents.some((otherPath) => moveParents.some((movePath) => samePath(otherPath, movePath)));
      if (sharesArray) {
        return { kind: "conflict", reason: `Concurrent structural change shares an array with moveNode of "${moveOperation.nodeId}".` };
      }
    }
  }
  if (operation.type === "mergeNode" || through.type === "mergeNode") {
    const mergeOperation = operation.type === "mergeNode" ? operation : through.type === "mergeNode" ? through : null;
    const other = mergeOperation === operation ? through : operation;
    if (mergeOperation) {
      const mergeSlots = mergeNodeSlots(mergeOperation);
      const otherSlots = occupiedSlotsOf(other);
      const overlaps = otherSlots?.some((otherSlot) => mergeSlots.some((mergeSlot) => isExactlyAtSlot(otherSlot, mergeSlot)));
      if (overlaps) {
        return { kind: "conflict", reason: "Concurrent operation occupies the same slot a mergeNode's left or right side depends on." };
      }
    }
  }
  if (through.type === "removeNode" && through.mergedInto) {
    const touch = operationTouchesSubtree(operation, through.pos);
    if (touch.within) {
      return { kind: "conflict", reason: `Concurrent operation targets content merged into "${through.mergedInto}".` };
    }
  }
  if (through.type === "replaceNode" && through.retiredInto?.length) {
    const touch = operationTouchesSubtree(operation, through.pos);
    if (touch.within) {
      return { kind: "conflict", reason: "Concurrent operation targets content retired by a merge." };
    }
  }
  // Symmetric case: `operation` (not `through`) is the merge - e.g.
  // rebasing a table-cell-merge transaction through a concurrent edit to
  // the cell it's about to absorb, the reverse pairing of the two checks
  // above. Naively letting this "succeed" would silently discard the
  // concurrent edit the instant the merge's removeNode/replaceNode
  // actually applies, with nothing in the result signaling that happened.
  if (operation.type === "removeNode" && operation.mergedInto) {
    const touch = operationTouchesSubtree(through, operation.pos);
    if (touch.within) {
      return { kind: "conflict", reason: `A concurrent operation targets content this merge would absorb into "${operation.mergedInto}".` };
    }
  }
  if (operation.type === "replaceNode" && operation.retiredInto?.length) {
    const touch = operationTouchesSubtree(through, operation.pos);
    if (touch.within) {
      return { kind: "conflict", reason: "A concurrent operation targets content this merge would retire." };
    }
  }
  // A deleteText operation carries the exact text it expects to remove, as
  // a self-check (operations.ts's applyToSession rejects it if the live
  // document doesn't match). If a concurrent insertText lands strictly
  // inside that span, the stored text is now stale relative to what's
  // actually there - mapOperation only shifts positions, it never touches
  // this payload (it has no document access to recompute it from), so
  // naively shifting the position and reapplying the original text would
  // either fail this self-check outright or, worse, delete the wrong
  // characters if the lengths happened to still line up. Flagged as a
  // conflict, consistent with the move/merge decisions above, rather than
  // guessing whether the new content should be swept into the deletion or
  // preserved. Deliberately excludes the boundary case (insert exactly at
  // the deletion's start or end) - only a strictly-interior insert is
  // ambiguous.
  if (operation.type === "deleteText" && through.type === "insertText" && samePath(operation.pos.path, through.pos.path)) {
    const deleteEnd = operation.pos.offset + operation.text.length;
    if (through.pos.offset > operation.pos.offset && through.pos.offset < deleteEnd) {
      return { kind: "conflict", reason: "Concurrent insertion lands inside a deleted range." };
    }
  }
  if (operation.type === "insertText" && through.type === "deleteText" && samePath(operation.pos.path, through.pos.path)) {
    const deleteEnd = through.pos.offset + through.text.length;
    if (operation.pos.offset > through.pos.offset && operation.pos.offset < deleteEnd) {
      return { kind: "conflict", reason: "Insertion lands inside a concurrently deleted range." };
    }
  }
  // Two overlapping deleteText ranges - same staleness problem as above:
  // whichever one is transformed second no longer has an accurate `.text`
  // payload for however much of its range the other one already removed
  // (found via a property test: two concurrent deletes of "45" and "4" at
  // the same offset - applying one first makes the other's stored text
  // immediately wrong). An *identical* delete (same offset, same text - two
  // authors deleting the exact same span) has no real ambiguity - the
  // second one's intent is already satisfied, so it's dropped as an
  // ordinary no-op rather than surfaced as a conflict. mapOperation itself
  // has no such exact-match handling for deleteText (confirmed via the same
  // property test - it left the position untouched, causing the identical
  // no-op case to crash too), so this is handled explicitly here, not
  // deferred.
  if (operation.type === "deleteText" && through.type === "deleteText" && samePath(operation.pos.path, through.pos.path)) {
    const opEnd = operation.pos.offset + operation.text.length;
    const throughEnd = through.pos.offset + through.text.length;
    const overlaps = operation.pos.offset < throughEnd && through.pos.offset < opEnd;
    const identical = operation.pos.offset === through.pos.offset && operation.text === through.text;
    if (identical) return { kind: "dropped" };
    if (overlaps) return { kind: "conflict", reason: "Concurrent deletions overlap." };
  }
  const mapped = mapOperation(operation, through, options);
  return mapped ? { kind: "ok", operation: mapped } : { kind: "dropped" };
};
