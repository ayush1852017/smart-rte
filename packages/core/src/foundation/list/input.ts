import { cloneNode, isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import type { ListSelectionScope } from "../scope/types.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos } from "../types.js";
import { outdentList, unwrapList } from "./commands.js";
import { resolvePrecedingContentTarget as resolveSharedPrecedingContentTarget } from "../structural/contentTarget.js";
import type { CommandContext } from "./types.js";

export interface ListSelectionTarget {
  readonly ownerId: string;
  readonly offset: number;
}

export interface ListInputResult {
  readonly operations: SmartOperation[];
  readonly selectionTarget: ListSelectionTarget;
  readonly intent: "split" | "indent" | "outdent" | "unwrap" | "merge-backward" | "merge-forward" | "line-break" | "check";
}

export interface ListEnterIds {
  readonly itemId: string;
  readonly blockId: string;
  readonly emptyBlockId: string;
}

interface ItemContext {
  item: SmartElementNode;
  itemPath: number[];
  list: SmartElementNode;
  listPath: number[];
  itemIndex: number;
  owner: SmartElementNode;
  ownerPath: number[];
  ownerIndex: number;
}

const inlineSize = (node: SmartElementNode) => (node.children || []).reduce((size, child) => size + (isTextNode(child) ? child.text.length : 1), 0);
const textChildren = (node: SmartElementNode) => (node.children || []).filter(isTextNode).map((child) => child.text).join("");
const isInlineOwner = (node: SmartElementNode) => node.type === "paragraph" || node.type === "heading";
const isElementNode = (node: SmartNode): node is SmartElementNode => !isTextNode(node);

const contextAt = (document: SmartDocument, pos: SmartPos): ItemContext | null => {
  const owner = nodeAtPath(document, pos.path);
  if (!owner || isTextNode(owner) || !isInlineOwner(owner)) return null;
  for (let depth = pos.path.length - 1; depth >= 0; depth -= 1) {
    const path = pos.path.slice(0, depth + 1);
    const node = nodeAtPath(document, path);
    if (!node || isTextNode(node) || node.type !== "list_item") continue;
    const listPath = path.slice(0, -1);
    const list = nodeAtPath(document, listPath);
    if (!list || isTextNode(list) || list.type !== "list") return null;
    const ownerIndex = (node.children || []).findIndex((child) => !isTextNode(child) && child.id === owner.id);
    return {
      item: node,
      itemPath: path,
      list,
      listPath,
      itemIndex: path[path.length - 1],
      owner,
      ownerPath: [...pos.path],
      ownerIndex,
    };
  }
  return null;
};

export const listItemAt = (document: SmartDocument, pos: SmartPos): { itemId: string; listId: string; depth: number } | null => {
  const context = contextAt(document, pos);
  if (!context) return null;
  let depth = 0;
  for (let index = 0; index < context.listPath.length; index += 1) {
    const ancestor = nodeAtPath(document, context.listPath.slice(0, index + 1));
    if (ancestor && !isTextNode(ancestor) && ancestor.type === "list") depth += 1;
  }
  return { itemId: context.item.id, listId: context.list.id, depth: Math.max(0, depth - 1) };
};

const itemScope = (document: SmartDocument, context: ItemContext): ListSelectionScope => ({
  kind: "list-selection",
  listId: context.list.id,
  items: [{ itemId: context.item.id, depth: listItemAt(document, { path: context.ownerPath, offset: 0 })?.depth || 0, hasChildList: Boolean(nestedList(context.item)) }],
  partialSubtree: false,
  promotedFromPartial: false,
  range: { from: { path: context.listPath, offset: context.itemIndex }, to: { path: context.listPath, offset: context.itemIndex + 1 } },
  isolatingAncestorId: null,
  clamped: false,
});

const nestedList = (item: SmartElementNode): SmartElementNode | null => {
  for (let index = (item.children?.length || 0) - 1; index >= 0; index -= 1) {
    const child = item.children?.[index];
    if (child && !isTextNode(child) && child.type === "list") return child;
  }
  return null;
};

const firstContentOwner = (item: SmartElementNode): SmartElementNode | null => {
  for (const child of item.children || []) if (!isTextNode(child) && child.type !== "list" && isInlineOwner(child)) return child;
  return null;
};
const deepestFirstItem = (item: SmartElementNode): SmartElementNode => {
  const nested = nestedList(item);
  const first = nested?.children?.[0];
  return first && !isTextNode(first) ? deepestFirstItem(first) : item;
};

/** Backspace target: deepest last visible descendant of the preceding sibling. */
/** Delete target: first visible descendant when present, otherwise next sibling. */
export const resolveFollowingContentTarget = (
  document: SmartDocument,
  itemId: string,
  ctx: CommandContext,
): { itemId: string; ownerId: string } | null => {
  const located = ctx.positions.positionOf(itemId);
  if (!located || located.parent.type !== "list") return null;
  const current = located.parent.children?.[located.pos.offset];
  if (!current || isTextNode(current)) return null;
  const ownNested = nestedList(current);
  const firstChild = ownNested?.children?.[0];
  if (firstChild && !isTextNode(firstChild)) {
    const target = deepestFirstItem(firstChild);
    const owner = firstContentOwner(target);
    return owner ? { itemId: target.id, ownerId: owner.id } : null;
  }
  const sibling = located.parent.children?.[located.pos.offset + 1];
  if (!sibling || isTextNode(sibling)) return null;
  const owner = firstContentOwner(sibling);
  return owner ? { itemId: sibling.id, ownerId: owner.id } : null;
};

const splitInlineOwner = (owner: SmartElementNode, offset: number, newId: string): [SmartElementNode, SmartElementNode] => {
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let consumed = 0;
  let split = false;
  for (const child of owner.children || []) {
    if (split) { after.push(child); continue; }
    const size = isTextNode(child) ? child.text.length : 1;
    const local = offset - consumed;
    if (local >= size) {
      before.push(child);
      consumed += size;
      continue;
    }
    if (isTextNode(child)) {
      if (local > 0) before.push({ ...child, text: child.text.slice(0, local) });
      if (local < size) after.push({ ...child, text: child.text.slice(local) });
    } else if (local === 0) after.push(child);
    else before.push(child);
    split = true;
    consumed += size;
  }
  const left = { ...owner, children: before };
  return [left, { ...owner, id: newId, children: after }];
};

const emptyParagraph = (id: string): SmartElementNode => ({ type: "paragraph", id, children: [] });

export const enterInList = (
  document: SmartDocument,
  pos: SmartPos,
  ids: ListEnterIds,
  ctx: CommandContext,
): ListInputResult | null => {
  const context = contextAt(document, pos);
  if (!context) return null;
  const scope = itemScope(document, context);
  const depth = scope.items[0].depth;
  const itemEmpty = (context.item.children || []).filter(isElementNode).filter((child) => child.type !== "list")
    .every((child) => isInlineOwner(child) && inlineSize(child) === 0);
  if (itemEmpty) {
    if (depth > 0) return {
      operations: outdentList(document, scope, {}, ctx),
      selectionTarget: { ownerId: context.owner.id, offset: 0 },
      intent: "outdent",
    };
    return {
      operations: unwrapList(document, scope, {}, ctx),
      selectionTarget: { ownerId: context.owner.id, offset: 0 },
      intent: "unwrap",
    };
  }
  const ownerLength = inlineSize(context.owner);
  const itemChildren = context.item.children || [];
  const atItemStart = context.ownerIndex === 0 && pos.offset === 0;
  const nonListChildren = itemChildren.filter((child) => isTextNode(child) || child.type !== "list");
  const atItemEnd = context.ownerIndex === nonListChildren.length - 1 && pos.offset === ownerLength;
  let first: SmartElementNode;
  let second: SmartElementNode;
  let target: ListSelectionTarget;
  if (atItemStart) {
    first = { type: "list_item", id: ids.itemId, children: [emptyParagraph(ids.emptyBlockId)] };
    second = context.item;
    target = { ownerId: context.owner.id, offset: 0 };
  } else if (atItemEnd) {
    first = context.item;
    second = { type: "list_item", id: ids.itemId, children: [emptyParagraph(ids.emptyBlockId)] };
    target = { ownerId: ids.emptyBlockId, offset: 0 };
  } else {
    const [leftOwner, rightOwner] = splitInlineOwner(context.owner, pos.offset, ids.blockId);
    const beforeBlocks = itemChildren.slice(0, context.ownerIndex);
    const afterBlocks = itemChildren.slice(context.ownerIndex + 1);
    first = { ...context.item, children: [...beforeBlocks, leftOwner] };
    // Nested lists and every block after the split stay with the second half.
    second = { ...context.item, id: ids.itemId, children: [rightOwner, ...afterBlocks] };
    target = { ownerId: rightOwner.id, offset: 0 };
  }
  const children = [...(context.list.children || [])];
  children.splice(context.itemIndex, 1, first, second);
  return {
    operations: [{ type: "replaceNode", pos: { path: context.listPath.slice(0, -1), offset: context.listPath[context.listPath.length - 1] }, before: context.list, after: { ...context.list, children } }],
    selectionTarget: target,
    intent: "split",
  };
};

const rootListForItem = (document: SmartDocument, itemId: string, ctx: CommandContext): SmartElementNode | null => {
  let position = ctx.positions.positionOf(itemId);
  if (!position) return null;
  let list = position.parent;
  while (list.type === "list") {
    const listPosition = ctx.positions.positionOf(list.id);
    if (!listPosition || listPosition.parent.type !== "list_item") return list;
    const parentItemPosition = ctx.positions.positionOf(listPosition.parent.id);
    if (!parentItemPosition) return list;
    list = parentItemPosition.parent;
  }
  return null;
};

const transformElement = (node: SmartElementNode, transform: (candidate: SmartElementNode) => SmartElementNode | null): SmartElementNode | null => {
  const direct = transform(node);
  if (!direct) return null;
  const children: SmartNode[] | undefined = direct.children ? [] : undefined;
  direct.children?.forEach((child) => {
    if (isTextNode(child)) children!.push(child);
    else {
      const next = transformElement(child, transform);
      if (next) children!.push(next);
    }
  });
  return children ? { ...direct, children } : direct;
};

const mergeOwners = (target: SmartElementNode, source: SmartElementNode, backward: boolean): SmartElementNode => {
  if (!isInlineOwner(target) || !isInlineOwner(source) || target.type !== source.type) return target;
  const children: SmartNode[] = [];
  [...(target.children || []), ...(source.children || []).map(cloneNode)].forEach((child) => {
    const previous = children[children.length - 1];
    if (previous && isTextNode(previous) && isTextNode(child)
      && JSON.stringify(previous.marks || []) === JSON.stringify(child.marks || [])) {
      children[children.length - 1] = { ...previous, text: previous.text + child.text };
    } else children.push(child);
  });
  return { ...target, children };
};

const mergeItems = (
  document: SmartDocument,
  sourceItemId: string,
  targetItemId: string,
  sourceOwnerId: string,
  targetOwnerId: string,
  backward: boolean,
  ctx: CommandContext,
): ListInputResult => {
  const root = rootListForItem(document, sourceItemId, ctx);
  if (!root) throw new Error("List merge root was not found.");
  const rootLocated = ctx.positions.positionOf(root.id);
  const sourceLocated = ctx.positions.positionOf(sourceItemId);
  const targetLocated = ctx.positions.positionOf(targetItemId);
  if (!rootLocated || !sourceLocated || !targetLocated) throw new Error("List merge positions are stale.");
  const sourceItem = sourceLocated.parent.children?.[sourceLocated.pos.offset];
  const targetItem = targetLocated.parent.children?.[targetLocated.pos.offset];
  if (!sourceItem || isTextNode(sourceItem) || !targetItem || isTextNode(targetItem)) throw new Error("List merge items are invalid.");
  const sourceOwner = (sourceItem.children || []).find((child) => !isTextNode(child) && child.id === sourceOwnerId);
  const targetOwner = (targetItem.children || []).find((child) => !isTextNode(child) && child.id === targetOwnerId);
  if (!sourceOwner || isTextNode(sourceOwner) || !targetOwner || isTextNode(targetOwner)) throw new Error("List merge owners are invalid.");
  const sourceOtherChildren = (sourceItem.children || []).filter((child) => isTextNode(child) || child.id !== sourceOwnerId);
  const targetOffset = inlineSize(targetOwner);
  const transformed = transformElement(root, (candidate) => {
    if (candidate.id === sourceItemId) return null;
    if (candidate.id !== targetItemId) return candidate;
    const mergedOwner = mergeOwners(targetOwner, sourceOwner, backward);
    const targetChildren = (candidate.children || []).map((child) => !isTextNode(child) && child.id === targetOwnerId ? mergedOwner : child);
    return { ...candidate, children: [...targetChildren, ...sourceOtherChildren] };
  });
  if (!transformed) throw new Error("List merge removed its root.");
  const cleaned = transformElement(transformed, (candidate) => candidate.type === "list" && !(candidate.children?.length) ? null : candidate);
  if (!cleaned) throw new Error("List merge produced an empty root list.");
  return {
    operations: [{ type: "replaceNode", pos: { path: [...rootLocated.pos.path], offset: rootLocated.pos.offset }, before: root, after: cleaned }],
    selectionTarget: { ownerId: targetOwnerId, offset: targetOffset },
    intent: backward ? "merge-backward" : "merge-forward",
  };
};

export const backspaceAtListItemStart = (
  document: SmartDocument,
  pos: SmartPos,
  ctx: CommandContext,
): ListInputResult | null => {
  const context = contextAt(document, pos);
  if (!context || pos.offset !== 0 || context.ownerIndex !== 0) return null;
  const metadata = listItemAt(document, pos)!;
  const scope = itemScope(document, context);
  if (metadata.depth > 0) return {
    operations: outdentList(document, scope, {}, ctx),
    selectionTarget: { ownerId: context.owner.id, offset: 0 },
    intent: "outdent",
  };
  if (context.itemIndex === 0) return {
    operations: unwrapList(document, scope, {}, ctx),
    selectionTarget: { ownerId: context.owner.id, offset: 0 },
    intent: "unwrap",
  };
  const resolved = resolveSharedPrecedingContentTarget(document, context.item.id, ctx);
  const targetItem = resolved && [...resolved.lineage].reverse().find((entry) => entry.type === "list_item");
  const target = resolved && targetItem ? { itemId: targetItem.nodeId, ownerId: resolved.ownerId } : null;
  return target ? mergeItems(document, context.item.id, target.itemId, context.owner.id, target.ownerId, true, ctx) : null;
};

export const deleteAtListItemEnd = (
  document: SmartDocument,
  pos: SmartPos,
  ctx: CommandContext,
): ListInputResult | null => {
  const context = contextAt(document, pos);
  if (!context || pos.offset !== inlineSize(context.owner)) return null;
  const target = resolveFollowingContentTarget(document, context.item.id, ctx);
  if (!target) return null;
  return mergeItems(document, target.itemId, context.item.id, target.ownerId, context.owner.id, false, ctx);
};
