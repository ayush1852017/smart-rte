import { isTextNode } from "../identity.js";
import { comparePos, nodeAtPath } from "../positions.js";
import type { PositionLookup } from "../scope/types.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos, SmartSelection } from "../types.js";

const samePath = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((part, index) => part === right[index]);
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
  const parentPath = selected.from.path.slice(0, -1);
  if (!samePath(parentPath, selected.to.path.slice(0, -1))) throw new Error("Clipboard copy is clamped to one structural parent.");
  const parent = nodeAtPath(document, parentPath);
  const toOwner = element(document, selected.to);
  if (!parent || isTextNode(parent) || !parent.children) throw new Error("Clipboard selection parent is invalid.");
  const fromIndex = selected.from.path[selected.from.path.length - 1];
  const toIndex = selected.to.path[selected.to.path.length - 1];
  const [, first] = split(fromOwner.children || [], selected.from.offset);
  const [last] = split(toOwner.children || [], selected.to.offset);
  return {
    type: "doc", id: document.id,
    children: [
      { ...fromOwner, children: first },
      ...parent.children.slice(fromIndex + 1, toIndex).map((node) => structuredClone(node)),
      { ...toOwner, children: last },
    ],
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
  const parent = nodeAtPath(document, parentPath);
  const toOwner = element(document, selected.to);
  if (!samePath(parentPath, selected.to.path.slice(0, -1)) || !parent || isTextNode(parent) || !parent.children) {
    throw new Error("Clipboard deletion is clamped to one structural parent.");
  }
  const fromIndex = selected.from.path[selected.from.path.length - 1];
  const toIndex = selected.to.path[selected.to.path.length - 1];
  const [before] = split(owner.children || [], selected.from.offset);
  const [, after] = split(toOwner.children || [], selected.to.offset);
  const operations: SmartOperation[] = [];
  for (let index = toIndex; index > fromIndex; index -= 1) operations.push({ type: "removeNode", pos: { path: [...parentPath], offset: index }, node: parent.children[index] });
  operations.push({ type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: [...before, ...after] } });
  return { operations, selectionTarget: { ownerId: owner.id, offset: selected.from.offset } };
};
