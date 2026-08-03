import { cloneNode, isTextNode } from "../identity.js";
import type {
  ListSelectionScope,
  MixedScope,
  ResolvedScope,
} from "../scope/types.js";
import type {
  Attrs,
  SmartDocument,
  SmartElementNode,
  SmartNode,
  SmartOperation,
  SmartPos,
} from "../types.js";
import type {
  CommandContext,
  ContinueListNumberingParams,
  CreateListParams,
  IndentListParams,
  InsertListFragmentParams,
  ListCommand,
  MoveListItemsParams,
  OutdentListParams,
  RestartListNumberingParams,
  SetListCheckedParams,
  SetListPresetParams,
  SetListStyleParams,
  UnwrapListParams,
} from "./types.js";

interface LocatedNode {
  node: SmartElementNode;
  pos: SmartPos;
}

const attrsOf = (node: SmartElementNode): Record<string, unknown> => ({ ...(node.attrs || {}) });
const withAttrs = (node: SmartElementNode, attrs: Record<string, unknown>): SmartElementNode => {
  const clean = Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));
  const { attrs: _attrs, ...rest } = node;
  return Object.keys(clean).length ? { ...rest, attrs: clean } : rest;
};
const withChildren = (node: SmartElementNode, children: readonly SmartNode[]): SmartElementNode => ({ ...node, children });

const locate = (document: SmartDocument, id: string, ctx: CommandContext): LocatedNode => {
  const resolved = ctx.positions.positionOf(id);
  if (!resolved) throw new Error(`Unknown node ID "${id}".`);
  const node = resolved.parent.children?.[resolved.pos.offset];
  if (!node || isTextNode(node) || node.id !== id) throw new Error(`PositionLookup returned a stale boundary for "${id}".`);
  return { node, pos: { path: [...resolved.pos.path], offset: resolved.pos.offset } };
};

const listScopes = (scope: ResolvedScope): ListSelectionScope[] => {
  if (scope.kind === "list-selection") return [scope];
  if (scope.kind !== "mixed") return [];
  const collect = (mixed: MixedScope): ListSelectionScope[] => mixed.parts.flatMap((part) =>
    part.kind === "list-selection" ? [part] : part.kind === "mixed" ? collect(part) : []);
  return collect(scope);
};

const blockIds = (scope: ResolvedScope): string[] => {
  if (scope.kind === "block-range") return [...scope.blockIds];
  if (scope.kind !== "mixed") return [];
  return scope.parts.flatMap((part) => blockIds(part));
};

const directItemIndexes = (list: SmartElementNode, scope: ListSelectionScope): number[] => {
  const wanted = new Set(scope.items.map((entry) => entry.itemId));
  return (list.children || []).flatMap((node, index) => !isTextNode(node) && wanted.has(node.id) ? [index] : []);
};

const contiguousRuns = (values: readonly number[]): Array<{ start: number; end: number }> => {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const runs: Array<{ start: number; end: number }> = [];
  sorted.forEach((value) => {
    const last = runs[runs.length - 1];
    if (last && value === last.end + 1) last.end = value;
    else runs.push({ start: value, end: value });
  });
  return runs;
};

const replacementSequence = (before: SmartElementNode, pos: SmartPos, after: readonly SmartNode[]): SmartOperation[] => {
  if (!after.length) return [{ type: "removeNode", pos, node: before }];
  const operations: SmartOperation[] = [{ type: "replaceNode", pos, before, after: after[0] }];
  after.slice(1).forEach((node, index) => operations.push({
    type: "insertNode",
    pos: { path: [...pos.path], offset: pos.offset + index + 1 },
    node,
  }));
  return operations;
};

const checkIds = (ids: readonly string[] | undefined, count: number, label: string): readonly string[] => {
  if (!ids || ids.length < count) throw new Error(`${label} requires ${count} caller-provided deterministic node ID(s).`);
  return ids;
};

/** Explicit style is the current-level override; preset supplies other levels. */
export const effectiveListStyle = (list: SmartElementNode): string | undefined =>
  typeof list.attrs?.style === "string" ? list.attrs.style
    : typeof list.attrs?.preset === "string" ? list.attrs.preset
      : undefined;

export const createList: ListCommand<CreateListParams> = (document, scope, params, ctx) => {
  const ids = blockIds(scope);
  if (!ids.length) return [];
  const located = ids.map((id) => ({ id, ...locate(document, id, ctx) }));
  const byParent = new Map<string, typeof located>();
  located.forEach((entry) => {
    const key = JSON.stringify(entry.pos.path);
    byParent.set(key, [...(byParent.get(key) || []), entry]);
  });
  const groups = [...byParent.values()].flatMap((entries) => {
    const byOffset = new Map(entries.map((entry) => [entry.pos.offset, entry]));
    return contiguousRuns(entries.map((entry) => entry.pos.offset)).map((run) => ({
      path: entries[0].pos.path,
      entries: Array.from({ length: run.end - run.start + 1 }, (_, index) => byOffset.get(run.start + index)!),
    }));
  }).sort((left, right) => right.entries[0].pos.offset - left.entries[0].pos.offset);
  const listIds = checkIds(params.listIds, groups.length, "list.create");
  const itemIds = checkIds(params.itemIds, located.length, "list.create");
  let itemCursor = 0;
  return groups.flatMap((group, groupIndex) => {
    const list: SmartElementNode = {
      type: "list",
      id: listIds[groupIndex],
      attrs: {
        ...(params.preset !== undefined ? { preset: params.preset } : {}),
        ...(params.style !== undefined ? { style: params.style } : {}),
        ...(params.start !== undefined ? { start: params.start } : {}),
        ...(params.checkable !== undefined ? { checkable: params.checkable } : {}),
      },
      children: group.entries.map((entry) => ({
        type: "list_item",
        id: itemIds[itemCursor++],
        ...(typeof entry.node.attrs?.htmlStyle === "string" ? { attrs: { htmlStyle: entry.node.attrs.htmlStyle } } : {}),
        children: [cloneNode(entry.node)],
      })),
    };
    const first = group.entries[0];
    const operations: SmartOperation[] = [{ type: "replaceNode", pos: first.pos, before: first.node, after: list }];
    group.entries.slice(1).forEach((entry) => operations.push({
      type: "removeNode",
      pos: { path: [...first.pos.path], offset: first.pos.offset + 1 },
      node: entry.node,
    }));
    return operations;
  });
};

const unwrapOne = (
  list: LocatedNode,
  selectedIndexes: readonly number[],
  splitId: string | undefined,
): SmartOperation[] => {
  if (!selectedIndexes.length) return [];
  const selected = new Set(selectedIndexes);
  const runs = contiguousRuns(selectedIndexes);
  if (runs.length !== 1) throw new Error("list.unwrap requires one contiguous item run per list.");
  const { start, end } = runs[0];
  const children = list.node.children || [];
  const beforeItems = children.slice(0, start);
  const afterItems = children.slice(end + 1);
  const unwrapped = children.slice(start, end + 1).flatMap((node) => {
    if (isTextNode(node)) throw new Error("List children must be list items.");
    return (node.children || []).filter((child) => !isTextNode(child) && child.type !== "list").map(cloneNode);
  });
  const sequence: SmartNode[] = [];
  if (beforeItems.length) sequence.push(withChildren(list.node, beforeItems));
  sequence.push(...unwrapped);
  if (afterItems.length) {
    const afterId = beforeItems.length ? splitId : list.node.id;
    if (!afterId) throw new Error("list.unwrap middle split requires a caller-provided splitListId.");
    sequence.push({ ...list.node, id: afterId, children: afterItems });
  }
  if (selected.size !== end - start + 1) throw new Error("Invalid selected list item indexes.");
  return replacementSequence(list.node, list.pos, sequence);
};

export const unwrapList: ListCommand<UnwrapListParams> = (document, scope, params, ctx) => {
  const scopes = listScopes(scope);
  let splitCursor = 0;
  return scopes.map((entry) => ({ entry, list: locate(document, entry.listId, ctx) }))
    .sort((a, b) => b.list.pos.offset - a.list.pos.offset)
    .flatMap(({ entry, list }) => {
      const indexes = directItemIndexes(list.node, entry);
      const middle = indexes.length && indexes[0] > 0 && indexes[indexes.length - 1] < (list.node.children?.length || 0) - 1;
      const splitId = middle ? params.splitListIds?.[splitCursor++] : undefined;
      return unwrapOne(list, indexes, splitId);
    });
};

const nestedListChild = (item: SmartElementNode): { node: SmartElementNode; index: number } | null => {
  const children = item.children || [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!isTextNode(child) && child.type === "list") return { node: child, index };
  }
  return null;
};

const compatibleNestedList = (parent: SmartElementNode, candidate: SmartElementNode): boolean => {
  const parentOrdered = /^(?:decimal|lower-|upper-|ordered)/.test(String(parent.attrs?.style || parent.attrs?.preset || ""));
  const candidateOrdered = /^(?:decimal|lower-|upper-|ordered)/.test(String(candidate.attrs?.style || candidate.attrs?.preset || ""));
  return parentOrdered === candidateOrdered && parent.attrs?.checkable === candidate.attrs?.checkable;
};

export const indentList: ListCommand<IndentListParams> = (document, scope, params, ctx) => {
  let idCursor = 0;
  return listScopes(scope).flatMap((entry) => {
    const located = locate(document, entry.listId, ctx);
    const indexes = directItemIndexes(located.node, entry);
    const runs = contiguousRuns(indexes);
    if (runs.length !== 1 || runs[0].start === 0) return [];
    const { start, end } = runs[0];
    const children = [...(located.node.children || [])];
    const previous = children[start - 1];
    if (!previous || isTextNode(previous)) throw new Error("List item predecessor is invalid.");
    const moved = children.slice(start, end + 1);
    const candidate = nestedListChild(previous);
    const nested = candidate && compatibleNestedList(located.node, candidate.node) ? candidate : null;
    let nextPrevious: SmartElementNode;
    if (nested) {
      const nextNested = withChildren(nested.node, [...(nested.node.children || []), ...moved]);
      nextPrevious = withChildren(previous, (previous.children || []).map((child, index) => index === nested.index ? nextNested : child));
    } else {
      const nestedId = checkIds(params.nestedListIds, idCursor + 1, "list.indent")[idCursor++];
      const nestedNode: SmartElementNode = { ...located.node, id: nestedId, children: moved };
      nextPrevious = withChildren(previous, [...(previous.children || []), nestedNode]);
    }
    const nextChildren = [...children.slice(0, start - 1), nextPrevious, ...children.slice(end + 1)];
    return [{ type: "replaceNode", pos: located.pos, before: located.node, after: withChildren(located.node, nextChildren) }];
  });
};

export const outdentList: ListCommand<OutdentListParams> = (document, scope, params, ctx) => {
  let splitCursor = 0;
  return listScopes(scope).flatMap((entry) => {
    const nested = locate(document, entry.listId, ctx);
    const indexes = directItemIndexes(nested.node, entry);
    if (!indexes.length) return [];
    const parentItemResolved = ctx.positions.positionOf(nested.node.id)?.parent;
    if (!parentItemResolved || parentItemResolved.type !== "list_item") {
      const middle = indexes[0] > 0 && indexes[indexes.length - 1] < (nested.node.children?.length || 0) - 1;
      return unwrapOne(nested, indexes, middle ? params.splitListIds?.[splitCursor++] : undefined);
    }
    const parentItem = parentItemResolved;
    const parentListResolved = ctx.positions.positionOf(parentItem.id)?.parent;
    if (!parentListResolved || parentListResolved.type !== "list") throw new Error("Nested list does not belong to a parent list item.");
    const parentList = locate(document, parentListResolved.id, ctx);
    const parentItemIndex = (parentList.node.children || []).findIndex((child) => !isTextNode(child) && child.id === parentItem.id);
    const selected = new Set(indexes);
    const moved = (nested.node.children || []).filter((_, index) => selected.has(index));
    const remaining = (nested.node.children || []).filter((_, index) => !selected.has(index));
    const updatedParentItem = withChildren(parentItem, (parentItem.children || []).flatMap((child) => {
      if (isTextNode(child) || child.id !== nested.node.id) return [child];
      return remaining.length ? [withChildren(nested.node, remaining)] : [];
    }));
    const nextParentChildren = [...(parentList.node.children || [])];
    nextParentChildren[parentItemIndex] = updatedParentItem;
    nextParentChildren.splice(parentItemIndex + 1, 0, ...moved);
    return [{ type: "replaceNode", pos: parentList.pos, before: parentList.node, after: withChildren(parentList.node, nextParentChildren) }];
  });
};

const replaceLists = (
  document: SmartDocument,
  scope: ResolvedScope,
  ctx: CommandContext,
  change: (list: SmartElementNode, entry: ListSelectionScope) => SmartElementNode,
): SmartOperation[] => listScopes(scope).map((entry) => ({ entry, list: locate(document, entry.listId, ctx) }))
  .map(({ entry, list }) => ({ type: "replaceNode" as const, pos: list.pos, before: list.node, after: change(list.node, entry) }));

export const setListPreset: ListCommand<SetListPresetParams> = (document, scope, params, ctx) =>
  replaceLists(document, scope, ctx, (list) => withAttrs(list, { ...attrsOf(list), preset: params.preset, style: undefined }));

export const setListStyle: ListCommand<SetListStyleParams> = (document, scope, params, ctx) =>
  replaceLists(document, scope, ctx, (list) => withAttrs(list, {
    ...attrsOf(list), style: params.style,
    ...(params.checkable !== undefined ? { checkable: params.checkable } : {}),
  }));

export const setListChecked: ListCommand<SetListCheckedParams> = (document, scope, params, ctx) =>
  replaceLists(document, scope, ctx, (list, entry) => {
    if (list.attrs?.checkable !== true) return list;
    const selected = new Set(entry.items.map((item) => item.itemId));
    return withChildren(list, (list.children || []).map((item) => {
      if (isTextNode(item) || !selected.has(item.id)) return item;
      return withAttrs(item, { ...attrsOf(item), checked: params.checked });
    }));
  });

/** Moves one contiguous item run by one sibling while preserving every item subtree and ID. */
export const moveListItems: ListCommand<MoveListItemsParams> = (document, scope, params, ctx) =>
  listScopes(scope).flatMap((entry) => {
    const located = locate(document, entry.listId, ctx);
    const runs = contiguousRuns(directItemIndexes(located.node, entry));
    if (runs.length !== 1) return [];
    const { start, end } = runs[0];
    const children = [...(located.node.children || [])];
    if (params.direction === "up") {
      if (start === 0) return [];
      const preceding = children[start - 1];
      const moved = children.slice(start, end + 1);
      children.splice(start - 1, moved.length + 1, ...moved, preceding);
    } else {
      if (end >= children.length - 1) return [];
      const following = children[end + 1];
      const moved = children.slice(start, end + 1);
      children.splice(start, moved.length + 1, following, ...moved);
    }
    return [{ type: "replaceNode", pos: located.pos, before: located.node, after: withChildren(located.node, children) }];
  });

export const restartListNumbering: ListCommand<RestartListNumberingParams> = (document, scope, params, ctx) => {
  if (!Number.isInteger(params.start) || params.start < 1) throw new Error("list.restartNumbering requires a positive integer.");
  return replaceLists(document, scope, ctx, (list) => withAttrs(list, { ...attrsOf(list), start: params.start }));
};

export const continueListNumbering: ListCommand<ContinueListNumberingParams> = (document, scope, _params, ctx) =>
  replaceLists(document, scope, ctx, (list) => withAttrs(list, { ...attrsOf(list), start: undefined }));

export const insertListFragment: ListCommand<InsertListFragmentParams> = (document, scope, params, ctx) => {
  const targetScope = listScopes(scope)[0];
  if (!targetScope) return [];
  const located = locate(document, targetScope.listId, ctx);
  const direct = directItemIndexes(located.node, targetScope);
  if (!direct.length && params.position !== "start" && params.position !== "end") return [];
  const fragmentNodes = params.fragment.children.flatMap((node) => {
    if (!isTextNode(node) && node.type === "list") return (node.children || []).map(cloneNode);
    return [cloneNode(node)];
  });
  const plainCount = fragmentNodes.filter((node) => isTextNode(node) || node.type !== "list_item").length;
  const itemIds = plainCount ? checkIds(params.itemIds, plainCount, "list fragment insertion") : [];
  let itemCursor = 0;
  const items: SmartNode[] = fragmentNodes.map((node) => !isTextNode(node) && node.type === "list_item" ? node : ({
    type: "list_item", id: itemIds[itemCursor++], children: [node],
  }));
  const insertionIndex = params.position === "start" ? 0
    : params.position === "end" ? (located.node.children?.length || 0)
      : params.position === "before" ? direct[0] : direct[direct.length - 1] + 1;
  const children = [...(located.node.children || [])];
  children.splice(insertionIndex, 0, ...items);
  return [{ type: "replaceNode", pos: located.pos, before: located.node, after: withChildren(located.node, children) }];
};

export const listCommands = {
  "list.create": createList,
  "list.unwrap": unwrapList,
  "list.indent": indentList,
  "list.outdent": outdentList,
  "list.setPreset": setListPreset,
  "list.setStyle": setListStyle,
  "list.setChecked": setListChecked,
  "list.move": moveListItems,
  "list.restartNumbering": restartListNumbering,
  "list.continueNumbering": continueListNumbering,
} as const;
