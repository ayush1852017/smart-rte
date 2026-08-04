import { isTextNode } from "../identity.js";
import { comparePos, nodeAtPath } from "../positions.js";
import type {
  SmartDocument, SmartElementNode, SmartNode, SmartOperation,
  SmartPos, SmartSchema, SmartSelection,
} from "../types.js";
import type { PositionLookup } from "../scope/types.js";

export interface ClipboardInsertionContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
  readonly idFactory: () => string;
}

export interface ClipboardInsertionResult {
  readonly operations: readonly SmartOperation[];
  readonly selectionTarget: { readonly ownerId: string; readonly offset: number };
  readonly definingAncestorId: string | null;
}

/** External paste is a copy: remint every non-text ID before insertion. */
export const remintClipboardFragmentIds = (fragment: SmartDocument, idFactory: () => string): SmartDocument => {
  const visit = (node: SmartNode): SmartNode => isTextNode(node) ? structuredClone(node) : {
    ...structuredClone(node), id: idFactory(), children: node.children?.map(visit),
  };
  return visit(fragment) as SmartDocument;
};

const inlineSize = (node: SmartNode) => isTextNode(node) ? node.text.length : 1;
const inlineChildren = (node: SmartElementNode) => node.children || [];
const inlineLength = (node: SmartElementNode) => inlineChildren(node).reduce((total, child) => total + inlineSize(child), 0);

const splitInline = (children: readonly SmartNode[], offset: number): [SmartNode[], SmartNode[]] => {
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let cursor = 0;
  children.forEach((node) => {
    const end = cursor + inlineSize(node);
    if (end <= offset) before.push(structuredClone(node));
    else if (cursor >= offset) after.push(structuredClone(node));
    else if (isTextNode(node)) {
      const local = offset - cursor;
      if (local) before.push({ ...node, text: node.text.slice(0, local) });
      if (local < node.text.length) after.push({ ...node, text: node.text.slice(local) });
    } else throw new Error("Clipboard insertion cannot split an atomic node.");
    cursor = end;
  });
  if (offset < 0 || offset > cursor) throw new Error("Clipboard insertion offset is out of bounds.");
  return [before, after];
};

const textOf = (node: SmartNode): string => isTextNode(node) ? node.text
  : node.type === "hard_break" ? "\n" : (node.children || []).map(textOf).join(node.type === "paragraph" ? "" : "\n");

const elementAt = (document: SmartDocument, pos: SmartPos): SmartElementNode => {
  const node = nodeAtPath(document, pos.path);
  if (!node || isTextNode(node)) throw new Error("Clipboard insertion requires an element owner.");
  return node;
};

const definingAncestor = (document: SmartDocument, path: readonly number[], schema: SmartSchema): string | null => {
  let result: string | null = null;
  for (let depth = 0; depth <= path.length; depth += 1) {
    const node = nodeAtPath(document, path.slice(0, depth));
    if (node && !isTextNode(node) && schema.nodes[node.type]?.defining === true) result = node.id;
  }
  return result;
};

const replacementRange = (selection: SmartSelection): { from: SmartPos; to: SmartPos } => {
  const compare = comparePos(selection.anchor, selection.head);
  return compare <= 0 ? { from: selection.anchor, to: selection.head } : { from: selection.head, to: selection.anchor };
};

const samePath = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index]);

const listItemPath = (document: SmartDocument, path: readonly number[]): number[] | null => {
  for (let depth = path.length; depth > 0; depth -= 1) {
    const candidate = nodeAtPath(document, path.slice(0, depth));
    if (candidate && !isTextNode(candidate) && candidate.type === "list_item") return path.slice(0, depth);
  }
  return null;
};

/**
 * Pure canonical-fragment insertion. The caller owns the transaction and maps
 * `selectionTarget` after applying the returned operations.
 */
export const insertClipboardFragment = (
  document: SmartDocument,
  selection: SmartSelection,
  fragment: SmartDocument,
  context: ClipboardInsertionContext,
): ClipboardInsertionResult => {
  const range = replacementRange(selection);
  const definingAncestorId = definingAncestor(document, range.from.path, context.schema);

  if (selection.type === "node") {
    const parent = nodeAtPath(document, range.from.path);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("Node selection parent is invalid.");
    const selected = parent.children[range.from.offset];
    if (!selected) throw new Error("Node selection is empty.");
    const nodes = fragment.children.map((node) => structuredClone(node));
    const operations: SmartOperation[] = [{ type: "removeNode", pos: range.from, node: selected }];
    nodes.forEach((node, index) => operations.push({ type: "insertNode", pos: { path: [...range.from.path], offset: range.from.offset + index }, node }));
    const target = [...nodes].reverse().find((node): node is SmartElementNode => !isTextNode(node));
    return {
      operations,
      selectionTarget: { ownerId: target?.id || parent.id, offset: target ? inlineLength(target) : range.from.offset },
      definingAncestorId,
    };
  }

  const owner = elementAt(document, range.from);
  if (owner.type === "code_block") {
    const [before] = splitInline(inlineChildren(owner), range.from.offset);
    const [, after] = splitInline(inlineChildren(owner), range.to.path.join("/") === range.from.path.join("/") ? range.to.offset : range.from.offset);
    const insertedText = fragment.children.map(textOf).join("\n");
    const afterNode: SmartElementNode = {
      ...owner,
      children: [...before, ...(insertedText ? [{ type: "text" as const, text: insertedText }] : []), ...after]
        .map((node) => isTextNode(node) ? { type: "text" as const, text: node.text } : node),
    };
    const position = context.positions.positionOf(owner.id);
    if (!position) throw new Error("Code block position is unavailable.");
    return {
      operations: [{ type: "replaceNode", pos: position.pos, before: owner, after: afterNode }],
      selectionTarget: { ownerId: owner.id, offset: range.from.offset + insertedText.length },
      definingAncestorId: owner.id,
    };
  }

  const itemPath = listItemPath(document, range.from.path);
  const fragmentBlocks = fragment.children.filter((node): node is SmartElementNode => !isTextNode(node));
  if (samePath(range.from.path, range.to.path) && range.from.offset === range.to.offset
    && itemPath && (fragmentBlocks.length > 1 || fragmentBlocks.some((node) => node.type === "list"))) {
    const item = nodeAtPath(document, itemPath);
    const list = nodeAtPath(document, itemPath.slice(0, -1));
    if (!item || isTextNode(item) || !list || isTextNode(list) || list.type !== "list") throw new Error("List paste target is invalid.");
    const insertedItems = fragmentBlocks.flatMap((block) => block.type === "list"
      ? (block.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type === "list_item").map((node) => structuredClone(node))
      : [{ type: "list_item" as const, id: context.idFactory(), children: [structuredClone(block)] }]);
    const index = itemPath[itemPath.length - 1];
    const children = [...(list.children || [])];
    children.splice(index + 1, 0, ...insertedItems);
    const listPosition = context.positions.positionOf(list.id);
    if (!listPosition) throw new Error("List position is unavailable.");
    const target = insertedItems[insertedItems.length - 1];
    const targetBlock = [...(target.children || [])].reverse().find((node): node is SmartElementNode => !isTextNode(node));
    return {
      operations: [{ type: "replaceNode", pos: listPosition.pos, before: list, after: { ...list, children } }],
      selectionTarget: { ownerId: targetBlock?.id || target.id, offset: targetBlock ? inlineLength(targetBlock) : 0 },
      definingAncestorId,
    };
  }

  if (!samePath(range.from.path, range.to.path)) {
    const parentPath = range.from.path.slice(0, -1);
    if (!samePath(parentPath, range.to.path.slice(0, -1))) throw new Error("Cross-parent clipboard replacement is clamped by scope before insertion.");
    const parent = nodeAtPath(document, parentPath);
    const toOwner = elementAt(document, range.to);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("Cross-owner parent is invalid.");
    const fromIndex = range.from.path[range.from.path.length - 1];
    const toIndex = range.to.path[range.to.path.length - 1];
    if (fromIndex >= toIndex) throw new Error("Cross-owner clipboard range is invalid.");
    const [prefix] = splitInline(inlineChildren(owner), range.from.offset);
    const [, suffix] = splitInline(inlineChildren(toOwner), range.to.offset);
    const ownerPosition = context.positions.positionOf(owner.id);
    if (!ownerPosition) throw new Error("Clipboard owner position is unavailable.");
    const operations: SmartOperation[] = [];
    for (let index = toIndex; index > fromIndex; index -= 1) operations.push({
      type: "removeNode", pos: { path: [...parentPath], offset: index }, node: parent.children[index],
    });
    const singleInline = fragmentBlocks.length === 1 && ["paragraph", "heading"].includes(fragmentBlocks[0].type);
    if (singleInline) {
      const inserted = inlineChildren(fragmentBlocks[0]).map((node) => structuredClone(node));
      operations.push({ type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: [...prefix, ...inserted, ...suffix] } });
      return {
        operations,
        selectionTarget: { ownerId: owner.id, offset: prefix.reduce((total, node) => total + inlineSize(node), 0) + inserted.reduce((total, node) => total + inlineSize(node), 0) },
        definingAncestorId,
      };
    }
    operations.push({ type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: prefix } });
    fragmentBlocks.forEach((node, index) => operations.push({ type: "insertNode", pos: { path: [...parentPath], offset: fromIndex + 1 + index }, node: structuredClone(node) }));
    let target = fragmentBlocks[fragmentBlocks.length - 1];
    if (suffix.length) {
      target = { type: "paragraph", id: context.idFactory(), children: suffix };
      operations.push({ type: "insertNode", pos: { path: [...parentPath], offset: fromIndex + 1 + fragmentBlocks.length }, node: target });
    }
    return { operations, selectionTarget: { ownerId: target?.id || owner.id, offset: target ? inlineLength(target) : 0 }, definingAncestorId };
  }
  const [prefix] = splitInline(inlineChildren(owner), range.from.offset);
  const [, suffix] = splitInline(inlineChildren(owner), range.to.offset);
  const ownerPosition = context.positions.positionOf(owner.id);
  if (!ownerPosition) throw new Error("Clipboard owner position is unavailable.");
  const blocks = fragmentBlocks.map((node) => structuredClone(node));
  const singleInline = blocks.length === 1 && ["paragraph", "heading"].includes(blocks[0].type);
  if (singleInline) {
    const inserted = inlineChildren(blocks[0]).map((node) => structuredClone(node));
    const after: SmartElementNode = { ...owner, children: [...prefix, ...inserted, ...suffix] };
    return {
      operations: [{ type: "replaceNode", pos: ownerPosition.pos, before: owner, after }],
      selectionTarget: { ownerId: owner.id, offset: prefix.reduce((total, node) => total + inlineSize(node), 0) + inserted.reduce((total, node) => total + inlineSize(node), 0) },
      definingAncestorId,
    };
  }

  const operations: SmartOperation[] = [{
    type: "replaceNode", pos: ownerPosition.pos, before: owner, after: { ...owner, children: prefix },
  }];
  blocks.forEach((node, index) => operations.push({
    type: "insertNode", pos: { path: [...ownerPosition.pos.path], offset: ownerPosition.pos.offset + 1 + index }, node,
  }));
  let target = blocks[blocks.length - 1];
  if (suffix.length) {
    const tail: SmartElementNode = { type: "paragraph", id: context.idFactory(), children: suffix };
    operations.push({ type: "insertNode", pos: { path: [...ownerPosition.pos.path], offset: ownerPosition.pos.offset + 1 + blocks.length }, node: tail });
    target = tail;
  }
  return {
    operations,
    selectionTarget: { ownerId: target?.id || owner.id, offset: target ? inlineLength(target) : 0 },
    definingAncestorId,
  };
};
