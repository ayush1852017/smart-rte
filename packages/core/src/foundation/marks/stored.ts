import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import { canonicalMarkOrder } from "./canonical.js";
import type { SmartDocument, SmartMark, SmartPos, SmartSchema } from "../types.js";

export const marksAtInsertion = (
  document: SmartDocument,
  pos: SmartPos,
  schema: SmartSchema,
): SmartMark[] => {
  const owner = nodeAtPath(document, pos.path);
  if (!owner || isTextNode(owner)) return [];
  let offset = 0;
  const segments = (owner.children || []).map((node) => {
    const from = offset;
    offset += isTextNode(node) ? node.text.length : 1;
    return { node, from, to: offset };
  });
  const inside = segments.find((segment) => isTextNode(segment.node) && segment.from < pos.offset && pos.offset < segment.to);
  if (inside && isTextNode(inside.node)) return canonicalMarkOrder(inside.node.marks);
  const candidates = [
    [...segments].reverse().find((segment) => isTextNode(segment.node) && segment.to === pos.offset),
    segments.find((segment) => isTextNode(segment.node) && segment.from === pos.offset),
  ];
  const marks = new Map<string, SmartMark>();
  candidates.forEach((segment) => {
    if (!segment || !isTextNode(segment.node)) return;
    segment.node.marks?.forEach((mark) => {
      if (schema.marks[mark.type]?.inclusive !== false) marks.set(mark.type, mark);
    });
  });
  return canonicalMarkOrder([...marks.values()]);
};
