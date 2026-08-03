import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import { markKey } from "./canonical.js";
import type { SmartDocument, SmartMark, SmartPos, SmartRange } from "../types.js";

export interface ResolvedMarkRun {
  readonly mark: SmartMark;
  readonly range: SmartRange;
  readonly ownerNodeId: string;
}

/** Resolves the complete contiguous run for one exact mark at a collapsed position. */
export const resolveMarkRun = (
  document: SmartDocument,
  pos: SmartPos,
  markType: string,
): ResolvedMarkRun | null => {
  const owner = nodeAtPath(document, pos.path);
  if (!owner || isTextNode(owner)) return null;
  let offset = 0;
  const segments = (owner.children || []).map((node) => {
    const from = offset;
    offset += isTextNode(node) ? node.text.length : 1;
    return { node, from, to: offset };
  });
  const active = [...segments].reverse().find((segment) => isTextNode(segment.node)
    && segment.from < pos.offset && pos.offset <= segment.to
    && segment.node.marks?.some((mark) => mark.type === markType))
    ?? segments.find((segment) => isTextNode(segment.node)
      && segment.from <= pos.offset && pos.offset < segment.to
      && segment.node.marks?.some((mark) => mark.type === markType));
  if (!active || !isTextNode(active.node)) return null;
  const mark = active.node.marks?.find((candidate) => candidate.type === markType);
  if (!mark) return null;
  const key = markKey(mark);
  let from = active.from;
  let to = active.to;
  const index = segments.indexOf(active);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const segment = segments[cursor];
    if (!isTextNode(segment.node) || !segment.node.marks?.some((candidate) => markKey(candidate) === key)) break;
    from = segment.from;
  }
  for (let cursor = index + 1; cursor < segments.length; cursor += 1) {
    const segment = segments[cursor];
    if (!isTextNode(segment.node) || !segment.node.marks?.some((candidate) => markKey(candidate) === key)) break;
    to = segment.to;
  }
  return {
    mark,
    ownerNodeId: owner.id,
    range: { from: { path: [...pos.path], offset: from }, to: { path: [...pos.path], offset: to } },
  };
};
