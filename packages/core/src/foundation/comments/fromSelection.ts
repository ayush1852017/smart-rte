import { comparePos, resolvePos, selectionRange } from "../positions.js";
import type { SmartDocument, SmartSelection } from "../types.js";
import type { AnnotationRange } from "../annotations/types.js";

/**
 * Builds the AnnotationRange a new comment thread should anchor to from the
 * editor's current selection - the reverse direction of
 * `resolveAnnotationRange` (AnnotationRange -> SmartRange). `resolvePos`'s
 * `nodeId` is exactly the id `resolveAnnotationRange`'s `resolveEndpoint`
 * expects for an offset-bearing endpoint (the owning node, not a text
 * node), so no separate id-lookup mechanism is needed here.
 *
 * Returns null for a collapsed selection (nothing to attach a comment to)
 * or a "none" selection (nothing selected at all). Every other selection
 * type - text, node, cell - resolves the same way, since `SmartPos`/
 * `resolvePos` already treat structural and inline owners uniformly.
 */
export const commentRangeFromSelection = (document: SmartDocument, selection: SmartSelection): AnnotationRange | null => {
  if (selection.type === "none") return null;
  const { from, to } = selectionRange(selection);
  if (comparePos(from, to) === 0) return null;
  const start = resolvePos(document, from);
  const end = resolvePos(document, to);
  return { startId: start.nodeId, startOffset: from.offset, endId: end.nodeId, endOffset: to.offset };
};
