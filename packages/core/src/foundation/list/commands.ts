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
import { moveContiguousSiblings } from "../structural/move.js";
import { isFoundationSmartListPreset } from "./presets.js";

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

/** How many list ancestors sit above this list — 0 for a top-level list, 1 for
 * a list nested one level inside a list_item, and so on. Used to stamp the
 * original nesting depth onto content unwrapped out of a list, so a later
 * list.create over that content (and other unwrapped content) can rebuild it. */
const listAncestorDepth = (list: SmartElementNode, ctx: CommandContext): number => {
  let depth = 0;
  let current: SmartElementNode = list;
  for (;;) {
    const resolved = ctx.positions.positionOf(current.id);
    if (!resolved || resolved.parent.type !== "list_item") return depth;
    const outer = ctx.positions.positionOf(resolved.parent.id)?.parent;
    if (!outer || outer.type !== "list") return depth;
    depth += 1;
    current = outer;
  }
};

const withDepthStamp = (node: SmartElementNode, depth: number): SmartElementNode =>
  depth <= 0 || typeof node.attrs?.indentLevel === "number" ? node : withAttrs(node, { ...attrsOf(node), indentLevel: depth });

/** Explicit style is the current-level override; preset supplies other levels. */
export const effectiveListStyle = (list: SmartElementNode): string | undefined =>
  typeof list.attrs?.style === "string" ? list.attrs.style
    : typeof list.attrs?.preset === "string" ? list.attrs.preset
      : undefined;

const withoutIndentLevel = (node: SmartElementNode): SmartElementNode =>
  typeof node.attrs?.indentLevel === "number" ? withAttrs(node, { ...attrsOf(node), indentLevel: undefined }) : node;

/** Clamps each block's indentLevel to at most one deeper than the block
 * immediately before it (mirroring indentList's "only nest under the
 * immediately preceding sibling" rule), so a selection built from a mix of
 * never-nested content and content previously unwrapped out of a list
 * (see withDepthStamp) always yields a structurally valid outline. */
const clampedDepths = (nodes: readonly SmartElementNode[]): number[] => {
  let previous = -1;
  return nodes.map((node) => {
    const raw = Math.max(0, Number(node.attrs?.indentLevel) || 0);
    const depth = Math.min(raw, previous + 1);
    previous = depth;
    return depth;
  });
};

interface DepthedEntry { readonly id: string; readonly node: SmartElementNode; readonly pos: SmartPos; }

/** Rebuilds a run of blocks at a common depth into list_items, recursing into
 * a nested list for any run of consecutively deeper blocks that follows one
 * of them — the reconstruction counterpart to withDepthStamp. */
const buildListItems = (
  entries: readonly DepthedEntry[],
  depths: readonly number[],
  base: number,
  nextItemId: () => string,
  nextListId: () => string,
  listAttrs: Record<string, unknown>,
): SmartElementNode[] => {
  const items: SmartElementNode[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    // Consume this item's own ID before descending into any deeper run, so
    // IDs are assigned in document order rather than the deepest/last entry
    // grabbing an earlier ID than an entry that appears before it.
    const itemId = nextItemId();
    const content = withoutIndentLevel(cloneNode(entry.node));
    index += 1;
    const deepStart = index;
    while (index < entries.length && depths[index] > base) index += 1;
    const children: SmartNode[] = [content];
    if (index > deepStart) children.push({
      type: "list",
      id: nextListId(),
      attrs: listAttrs,
      children: buildListItems(entries.slice(deepStart, index), depths.slice(deepStart, index), base + 1, nextItemId, nextListId, listAttrs),
    });
    items.push({
      type: "list_item",
      id: itemId,
      ...(typeof entry.node.attrs?.htmlStyle === "string" ? { attrs: { htmlStyle: entry.node.attrs.htmlStyle } } : {}),
      children,
    });
  }
  return items;
};

export const createList: ListCommand<CreateListParams> = (document, scope, params, ctx) => {
  if (params.preset !== undefined && !isFoundationSmartListPreset(params.preset)) return [];
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
  const itemIds = checkIds(params.itemIds, located.length, "list.create");
  let itemCursor = 0;
  let listCursor = 0;
  // A reconstructed group may need more than one list node (one per nesting
  // transition), which isn't known until the content's depths are read. The
  // caller over-provisions listIds; this consumes only what's needed and
  // fails clearly, matching indentList's per-step checkIds pattern, if it
  // genuinely runs out.
  const nextListId = (): string => checkIds(params.listIds, listCursor + 1, "list.create")[listCursor++];
  const listAttrs = {
    ...(params.preset !== undefined ? { preset: params.preset } : {}),
    ...(params.style !== undefined ? { style: params.style } : {}),
    ...(params.start !== undefined ? { start: params.start } : {}),
    ...(params.checkable !== undefined ? { checkable: params.checkable } : {}),
  };
  return groups.flatMap((group) => {
    const depths = clampedDepths(group.entries.map((entry) => entry.node));
    const list: SmartElementNode = {
      type: "list",
      id: nextListId(),
      attrs: listAttrs,
      children: buildListItems(group.entries, depths, 0, () => itemIds[itemCursor++], nextListId, listAttrs),
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
  depth: number,
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
    // Unwrapping removes the list-item wrapper, not its descendants. Nested
    // lists become sibling block content at the new level; dropping them here
    // loses user content and leaves a later mixed-scope selection with no list
    // part to act on. The top-level unwrapped children are stamped with the
    // list's nesting depth so a later list.create can rebuild it; a nested
    // list carried along unchanged still encodes its own relative depth via
    // its own item structure, so it is left alone.
    return (node.children || []).map((child) => {
      const cloned = cloneNode(child);
      return isTextNode(cloned) || cloned.type === "list" ? cloned : withDepthStamp(cloned, depth);
    });
  });
  const sequence: SmartNode[] = [];
  if (beforeItems.length) sequence.push(withChildren(list.node, beforeItems));
  sequence.push(...unwrapped);
  if (afterItems.length) {
    const afterId = beforeItems.length ? splitId : list.node.id;
    if (!afterId) throw new Error("list.unwrap middle split requires a caller-provided splitListId.");
    // A middle unwrap splits an ordered list into two list nodes — without
    // this, the trailing portion silently restarts its own numbering at 1
    // instead of continuing from where the original list left off.
    // Harmless to set on an unordered list; `start` is simply unused there.
    const priorStart = typeof list.node.attrs?.start === "number" ? list.node.attrs.start : 1;
    const continuedStart = priorStart + end + 1;
    sequence.push(withAttrs({ ...list.node, id: afterId, children: afterItems }, { ...attrsOf(list.node), start: continuedStart }));
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
      return unwrapOne(list, indexes, splitId, listAncestorDepth(list.node, ctx));
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

/** Indent is a decision about the selected line(s), not their whole subtree.
 * A moved item's own nested list is unwrapped one level rather than carried
 * along — its direct children become siblings of the moved item at its new
 * position, in the same order, instead of silently ending up one level
 * deeper than before. Only the moved item's own nested list unwraps; each
 * hoisted child keeps whatever nested structure it independently has. */
const flattenMovedItem = (node: SmartNode): SmartElementNode[] => {
  if (isTextNode(node)) throw new Error("List children must be list items.");
  const item = node;
  const nested = nestedListChild(item);
  if (!nested) return [item];
  const withoutNested = withChildren(item, (item.children || []).filter((_, index) => index !== nested.index));
  const hoisted = (nested.node.children || []).filter((child): child is SmartElementNode => !isTextNode(child));
  return [withoutNested, ...hoisted];
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
    const moved = children.slice(start, end + 1).flatMap(flattenMovedItem);
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
      return unwrapOne(nested, indexes, middle ? params.splitListIds?.[splitCursor++] : undefined, listAncestorDepth(nested.node, ctx));
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

// Marker CSS is keyed on `[data-srte-list-preset][data-srte-list-depth]` on
// each list element individually — depth alone does not select a marker
// without a matching preset on that same nested list. A style/preset change
// must therefore cascade into every nested list, not just the selected one,
// or descendant items keep rendering their old marker family.
const withNestedListsRestyled = (
  list: SmartElementNode,
  restyle: (nested: SmartElementNode) => SmartElementNode,
): SmartElementNode => withChildren(restyle(list), (list.children || []).map((item) => {
  if (isTextNode(item) || item.type !== "list_item") return item;
  return withChildren(item, (item.children || []).map((child) =>
    !isTextNode(child) && child.type === "list" ? withNestedListsRestyled(child, restyle) : child));
}));

export const setListPreset: ListCommand<SetListPresetParams> = (document, scope, params, ctx) =>
  (params.preset !== undefined && !isFoundationSmartListPreset(params.preset)
    ? []
    : replaceLists(document, scope, ctx, (list) => withNestedListsRestyled(list, (nested) =>
        withAttrs(nested, { ...attrsOf(nested), preset: params.preset, style: undefined }))));

export const setListStyle: ListCommand<SetListStyleParams> = (document, scope, params, ctx) =>
  replaceLists(document, scope, ctx, (list) => {
    // A concrete style is a state transition, not an additional marker. A
    // stale preset makes serializers and CSS consumers see two competing list
    // definitions after numbered → bulleted/checklist changes. Style/preset
    // cascade to nested lists (see withNestedListsRestyled); `checkable` does
    // not — converting an outer list to a checklist should not silently make
    // every nested sublist checkable too.
    const restyled = withNestedListsRestyled(list, (nested) => withAttrs(nested, { ...attrsOf(nested), preset: undefined, style: params.style }));
    return params.checkable !== undefined ? withAttrs(restyled, { ...attrsOf(restyled), checkable: params.checkable }) : restyled;
  });

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
export const moveListItems: ListCommand<MoveListItemsParams> = (_document, scope, params, ctx) =>
  listScopes(scope).flatMap((entry) => moveContiguousSiblings(entry.items.map((item) => item.itemId), params.direction, ctx));

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
