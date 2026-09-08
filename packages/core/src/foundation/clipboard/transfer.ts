import { isTextNode } from "../identity.js";
import { comparePos, nodeAtPath } from "../positions.js";
import type { PositionLookup } from "../scope/types.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos, SmartSelection } from "../types.js";

const samePath = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((part, index) => part === right[index]);
const commonPrefixLength = (left: readonly number[], right: readonly number[]): number => {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
};
const size = (node: SmartNode) => isTextNode(node) ? node.text.length : 1;
const split = (children: readonly SmartNode[], offset: number): [SmartNode[], SmartNode[]] => {
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let cursor = 0;
  children.forEach((node) => {
    const end = cursor + size(node);
    if (end <= offset) before.push(structuredClone(node));
    else if (cursor >= offset) after.push(structuredClone(node));
    else if (isTextNode(node)) {
      const local = offset - cursor;
      if (local) before.push({ ...node, text: node.text.slice(0, local) });
      if (local < node.text.length) after.push({ ...node, text: node.text.slice(local) });
    }
    cursor = end;
  });
  return [before, after];
};
const range = (selection: SmartSelection) => comparePos(selection.anchor, selection.head) <= 0
  ? { from: selection.anchor, to: selection.head } : { from: selection.head, to: selection.anchor };
const element = (document: SmartDocument, pos: SmartPos) => {
  const node = nodeAtPath(document, pos.path);
  if (!node || isTextNode(node)) throw new Error("Clipboard selection owner is invalid.");
  return node;
};

/**
 * `node`'s content, keeping only what lies at-or-after (path, offset) within it -
 * fully-included later siblings at every level, and a recursively-trimmed branch
 * for the one that actually contains the position. Used for the tail (or "from")
 * endpoint of a selection that crosses into a different structural ancestor than
 * its other endpoint (e.g. from a plain paragraph into a nested list item) - a
 * selection shape that isn't naturally isTextNode/same-parent, but is still a
 * perfectly ordinary drag-selection a user can make.
 */
const afterSlice = (node: SmartElementNode, path: readonly number[], offset: number): SmartElementNode => {
  const children = node.children || [];
  if (path.length === 0) {
    const [, tail] = split(children, offset);
    return { ...node, children: tail };
  }
  const index = path[0];
  const child = children[index];
  if (!child || isTextNode(child)) throw new Error("Clipboard selection path is malformed.");
  const rest = children.slice(index + 1).map((sibling) => structuredClone(sibling));
  return { ...node, children: [afterSlice(child, path.slice(1), offset), ...rest] };
};

/** Mirror of {@link afterSlice}: keeps only what lies strictly before (path, offset). */
const beforeSlice = (node: SmartElementNode, path: readonly number[], offset: number): SmartElementNode => {
  const children = node.children || [];
  if (path.length === 0) {
    const [before] = split(children, offset);
    return { ...node, children: before };
  }
  const index = path[0];
  const child = children[index];
  if (!child || isTextNode(child)) throw new Error("Clipboard selection path is malformed.");
  const rest = children.slice(0, index).map((sibling) => structuredClone(sibling));
  return { ...node, children: [...rest, beforeSlice(child, path.slice(1), offset)] };
};

export const sliceClipboardSelection = (document: SmartDocument, selection: SmartSelection): SmartDocument => {
  const selected = range(selection);
  if (selection.type === "node" || selection.type === "cell") {
    const parent = nodeAtPath(document, selected.from.path);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("Clipboard node selection parent is invalid.");
    return { type: "doc", id: document.id, children: parent.children.slice(selected.from.offset, selected.to.offset).map((node) => structuredClone(node)) };
  }
  const fromOwner = element(document, selected.from);
  if (samePath(selected.from.path, selected.to.path)) {
    const [, tail] = split(fromOwner.children || [], selected.from.offset);
    const [content] = split(tail, selected.to.offset - selected.from.offset);
    return { type: "doc", id: document.id, children: [{ ...fromOwner, children: content }] };
  }
  // The two endpoints don't share an immediate parent - they may still share a
  // deeper common ancestor (e.g. one endpoint is a plain paragraph and the other
  // is nested inside a list item or table cell several levels down, an entirely
  // ordinary drag-selection). Slice each endpoint's own top-level branch under
  // that ancestor recursively, rather than assuming a flat sibling relationship.
  const commonLength = commonPrefixLength(selected.from.path, selected.to.path);
  const ancestorPath = selected.from.path.slice(0, commonLength);
  const ancestor = nodeAtPath(document, ancestorPath);
  if (!ancestor || isTextNode(ancestor) || !ancestor.children) throw new Error("Clipboard selection ancestor is invalid.");
  const fromIndex = selected.from.path[commonLength];
  const toIndex = selected.to.path[commonLength];
  const fromBranch = ancestor.children[fromIndex];
  const toBranch = ancestor.children[toIndex];
  if (!fromBranch || !toBranch || isTextNode(fromBranch) || isTextNode(toBranch)) throw new Error("Clipboard selection endpoint is invalid.");
  const first = afterSlice(fromBranch, selected.from.path.slice(commonLength + 1), selected.from.offset);
  const last = beforeSlice(toBranch, selected.to.path.slice(commonLength + 1), selected.to.offset);
  return {
    type: "doc", id: document.id,
    children: [first, ...ancestor.children.slice(fromIndex + 1, toIndex).map((node) => structuredClone(node)), last],
  };
};

export interface ClipboardDeletionResult {
  readonly operations: readonly SmartOperation[];
  readonly selectionTarget: { readonly ownerId: string; readonly offset: number };
}

export const deleteClipboardSelection = (
  document: SmartDocument,
  selection: SmartSelection,
  positions: PositionLookup,
): ClipboardDeletionResult => {
  const selected = range(selection);
  if (selection.type === "node" || selection.type === "cell") {
    const parent = nodeAtPath(document, selected.from.path);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("Clipboard node deletion parent is invalid.");
    const operations: SmartOperation[] = [];
    for (let index = selected.to.offset - 1; index >= selected.from.offset; index -= 1) operations.push({
      type: "removeNode", pos: { path: [...selected.from.path], offset: index }, node: parent.children[index],
    });
    return { operations, selectionTarget: { ownerId: parent.id, offset: selected.from.offset } };
  }
  const owner = element(document, selected.from);
  const ownerPosition = positions.positionOf(owner.id);
  if (!ownerPosition) throw new Error("Clipboard deletion owner position is unavailable.");
  if (samePath(selected.from.path, selected.to.path)) {
    const [before] = split(owner.children || [], selected.from.offset);
    const [, after] = split(owner.children || [], selected.to.offset);
    return {
      operations: [{ type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: [...before, ...after] } }],
      selectionTarget: { ownerId: owner.id, offset: selected.from.offset },
    };
  }
  const parentPath = selected.from.path.slice(0, -1);
  const toOwner = element(document, selected.to);
  if (samePath(parentPath, selected.to.path.slice(0, -1))) {
    const parent = nodeAtPath(document, parentPath);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("Clipboard deletion parent is invalid.");
    const fromIndex = selected.from.path[selected.from.path.length - 1];
    const toIndex = selected.to.path[selected.to.path.length - 1];
    const [before] = split(owner.children || [], selected.from.offset);
    const [, after] = split(toOwner.children || [], selected.to.offset);
    const operations: SmartOperation[] = [];
    for (let index = toIndex; index > fromIndex; index -= 1) operations.push({ type: "removeNode", pos: { path: [...parentPath], offset: index }, node: parent.children[index] });
    operations.push({ type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: [...before, ...after] } });
    return { operations, selectionTarget: { ownerId: owner.id, offset: selected.from.offset } };
  }
  // Endpoints live under different immediate parents (e.g. cutting from a plain
  // paragraph into a nested list item) - too structurally different to merge
  // into one owner the way same-parent siblings do above, but still coherent:
  // trim each endpoint's own top-level branch down to what's unselected, remove
  // any branch fully between them, and leave both trimmed branches in place.
  const commonLength = commonPrefixLength(selected.from.path, selected.to.path);
  const ancestorPath = selected.from.path.slice(0, commonLength);
  const ancestor = nodeAtPath(document, ancestorPath);
  if (!ancestor || isTextNode(ancestor) || !ancestor.children) throw new Error("Clipboard deletion ancestor is invalid.");
  const fromIndex = selected.from.path[commonLength];
  const toIndex = selected.to.path[commonLength];
  const fromBranch = ancestor.children[fromIndex];
  const toBranch = ancestor.children[toIndex];
  if (!fromBranch || !toBranch || isTextNode(fromBranch) || isTextNode(toBranch)) throw new Error("Clipboard deletion endpoint is invalid.");
  const trimmedFrom = beforeSlice(fromBranch, selected.from.path.slice(commonLength + 1), selected.from.offset);
  const trimmedTo = afterSlice(toBranch, selected.to.path.slice(commonLength + 1), selected.to.offset);
  const operations: SmartOperation[] = [
    { type: "replaceNode", pos: { path: [...ancestorPath], offset: toIndex }, before: toBranch, after: trimmedTo },
  ];
  for (let index = toIndex - 1; index > fromIndex; index -= 1) {
    operations.push({ type: "removeNode", pos: { path: [...ancestorPath], offset: index }, node: ancestor.children[index] });
  }
  operations.push({ type: "replaceNode", pos: { path: [...ancestorPath], offset: fromIndex }, before: fromBranch, after: trimmedFrom });
  return { operations, selectionTarget: { ownerId: owner.id, offset: selected.from.offset } };
};
