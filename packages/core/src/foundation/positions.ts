import { isTextNode } from "./identity.js";
import type { ResolvedPos, SmartDocument, SmartElementNode, SmartNode, SmartPos, SmartRange, SmartSelection } from "./types.js";

export const samePath = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

export const nodeAtPath = (document: SmartDocument, path: readonly number[]): SmartNode | undefined => {
  let node: SmartNode = document;
  for (const index of path) {
    if (isTextNode(node) || !node.children || index < 0 || index >= node.children.length) return undefined;
    node = node.children[index];
  }
  return node;
};

/** Inline atomic nodes are one indivisible offset unit (the model equivalent of U+FFFC). */
export const inlineSize = (node: SmartNode): number => isTextNode(node) ? node.text.length : 1;

export const positionLimit = (node: SmartNode): number => {
  if (isTextNode(node)) return node.text.length;
  if (node.children && (node.type === "paragraph" || node.type === "heading")) {
    return node.children.reduce((total, child) => total + inlineSize(child), 0);
  }
  return node.children?.length || (node.type === "unknown" ? 1 : 0);
};

export const resolvePos = (
  document: SmartDocument,
  pos: SmartPos,
  affinity: "forward" | "backward" = "backward",
): ResolvedPos => {
  const node = nodeAtPath(document, pos.path);
  if (!node || isTextNode(node)) throw new Error("A SmartPos path must resolve to an owning non-text node.");
  const limit = positionLimit(node);
  if (!Number.isInteger(pos.offset) || pos.offset < 0 || pos.offset > limit) {
    throw new Error(`Position offset ${pos.offset} is outside 0..${limit}.`);
  }
  const ancestors: SmartElementNode[] = [];
  let current: SmartNode = document;
  ancestors.push(document);
  for (const index of pos.path) {
    if (isTextNode(current) || !current.children) throw new Error("Invalid position path.");
    current = current.children[index];
    if (!isTextNode(current)) ancestors.push(current);
  }
  const structural = node.type !== "paragraph" && node.type !== "heading";
  const before = structural && pos.offset > 0 ? node.children?.[pos.offset - 1] || null : null;
  const after = structural && pos.offset < limit ? node.children?.[pos.offset] || null : null;
  return {
    pos: { path: [...pos.path], offset: pos.offset },
    kind: structural ? "structural" : "inline",
    nodeId: node.id,
    parent: node,
    depth: pos.path.length,
    affinity,
    ancestors: Object.freeze(ancestors),
    nodeBefore: before,
    nodeAfter: after,
    atStart: pos.offset === 0,
    atEnd: pos.offset === limit,
    indexAt(depth: number) {
      if (!Number.isInteger(depth) || depth < 0 || depth >= pos.path.length) throw new Error("Position depth is out of range.");
      return pos.path[depth];
    },
  };
};

export const comparePos = (left: SmartPos, right: SmartPos): number => {
  const length = Math.min(left.path.length, right.path.length);
  for (let index = 0; index < length; index += 1) {
    if (left.path[index] !== right.path[index]) return left.path[index] - right.path[index];
  }
  if (left.path.length !== right.path.length) return left.path.length - right.path.length;
  return left.offset - right.offset;
};

export const selectionRange = (selection: SmartSelection): SmartRange =>
  comparePos(selection.anchor, selection.head) <= 0
    ? { from: selection.anchor, to: selection.head }
    : { from: selection.head, to: selection.anchor };

interface GraphemeSegment { index: number; segment: string }
interface GraphemeSegmenter { segment(text: string): Iterable<GraphemeSegment> }
const Segmenter = (Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;
const segmenter = new Segmenter(undefined, { granularity: "grapheme" });

export const graphemeBoundaries = (text: string): number[] => {
  const boundaries = [0];
  for (const segment of segmenter.segment(text)) boundaries.push(segment.index + segment.segment.length);
  return [...new Set(boundaries)].sort((a, b) => a - b);
};

/**
 * Grapheme-safe inline offsets. Each text child is segmented independently and
 * each inline atom contributes one indivisible unit, so a cluster can never
 * bridge across an atom boundary.
 */
export const inlineGraphemeBoundaries = (children: readonly SmartNode[]): number[] => {
  const boundaries = [0];
  let offset = 0;
  children.forEach((child) => {
    if (isTextNode(child)) {
      graphemeBoundaries(child.text).slice(1).forEach((boundary) => boundaries.push(offset + boundary));
      offset += child.text.length;
    } else {
      offset += 1;
      boundaries.push(offset);
    }
  });
  return [...new Set(boundaries)].sort((left, right) => left - right);
};

export const previousGraphemeBoundary = (text: string, offset: number): number => {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error("Text offset is out of bounds.");
  const boundaries = graphemeBoundaries(text);
  for (let index = boundaries.length - 1; index >= 0; index -= 1) if (boundaries[index] < offset) return boundaries[index];
  return 0;
};

export const nextGraphemeBoundary = (text: string, offset: number): number => {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error("Text offset is out of bounds.");
  return graphemeBoundaries(text).find((boundary) => boundary > offset) ?? text.length;
};

export const moveGrapheme = (text: string, offset: number, direction: -1 | 1): number =>
  direction < 0 ? previousGraphemeBoundary(text, offset) : nextGraphemeBoundary(text, offset);

export const graphemeBackspaceRange = (position: ResolvedPos, text: string): SmartRange => ({
  from: { path: [...position.pos.path], offset: previousGraphemeBoundary(text, position.pos.offset) },
  to: { path: [...position.pos.path], offset: position.pos.offset },
});
