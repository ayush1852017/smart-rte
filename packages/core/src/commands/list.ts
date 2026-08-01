import {
  getNodeAtPath,
  paragraph,
  type Path,
  type SmartBlockNode,
  type SmartDocument,
  type SmartListNode,
  type SmartListPreset,
  type SmartTableCellNode,
  type SmartTableNode,
} from "../model.js";
import type { CommandContext, SmartCommand } from "../command.js";
import { listFromBlocks } from "../table.js";
import { replaceNodeAtPath } from "../tree.js";
import type { SmartSelection } from "../selection.js";
import type { SmartTransaction } from "../transaction.js";
import { resolveListSelectionScope } from "../listScope.js";
import { listStyleForPresetDepth } from "../listPresets.js";

export type ListStyle = SmartListNode["style"];

export interface ToggleTableCellListInput {
  tablePath: Path;
  row: number;
  column: number;
  blockIndexes: readonly number[];
  style: ListStyle;
  preset?: SmartListPreset;
}

export interface CommandResult {
  document: SmartDocument;
  transaction: SmartTransaction;
}

export interface ToggleListInput {
  style: ListStyle;
  preset?: SmartListPreset;
  /**
   * Toolbar list buttons use `containing-list` semantics by default, matching
   * document editors that change the whole list when selection is inside it.
   * Contextual item tools may request an exact selected run instead.
   */
  scope?: "containing-list" | "selected-items";
  cascadeStyles?: boolean;
  checklist?: boolean;
  strikeCompleted?: boolean;
}

type ListTarget =
  | { kind: "range"; containerPath: Path; start: number; end: number }
  | { kind: "items"; listPath: Path; start: number; end: number }
  | { kind: "mixed"; containerPath: Path; blockIndex: number; listPath: Path; itemStart: number; itemEnd: number };

const samePath = (left: Path, right: Path) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const isBlock = (node: unknown): node is SmartBlockNode =>
  Boolean(node) && typeof node === "object" &&
  ["paragraph", "heading", "list", "blockquote", "codeBlock", "table"]
    .includes((node as { type?: string }).type || "");

const selectionPaths = (selection: SmartSelection): [Path, Path] | null => {
  if (selection.type === "text") return [selection.anchor.path, selection.focus.path];
  if (selection.type === "node") return [selection.path, selection.path];
  return null;
};

const structuralUnit = (
  document: SmartDocument,
  path: Path,
): { path: Path; listItemIndex?: number } | null => {
  let firstBlockPath: Path | null = null;
  for (let depth = 1; depth <= path.length; depth += 1) {
    const candidatePath = path.slice(0, depth);
    const node = getNodeAtPath(document, candidatePath);
    if (!isBlock(node)) continue;
    if (!firstBlockPath) firstBlockPath = candidatePath;
    if (node.type === "list") {
      const itemIndex = path[depth];
      return {
        path: candidatePath,
        ...(Number.isInteger(itemIndex) ? { listItemIndex: itemIndex } : {}),
      };
    }
    // A table is a container boundary, not a selectable text block.
    if (node.type === "table") firstBlockPath = null;
  }
  return firstBlockPath ? { path: firstBlockPath } : null;
};

const resolveListTarget = (context: CommandContext): ListTarget | null => {
  const scope = resolveListSelectionScope(context.document, context.selection);
  if (scope.kind === "none") return null;
  if (scope.kind === "all") return { kind: "range", containerPath: [], start: 0, end: context.document.children.length - 1 };
  if (scope.kind === "blocks") return { kind: "range", containerPath: scope.containerPath, start: scope.start, end: scope.end };
  if (scope.kind === "list") return { kind: "items", listPath: scope.listPath, start: scope.start, end: scope.end };
  if (scope.kind === "mixed") return { kind: "mixed", containerPath: scope.containerPath, blockIndex: scope.blockIndex, listPath: scope.listPath, itemStart: scope.itemStart, itemEnd: scope.itemEnd };
  return null;
};

const itemFromBlock = (block: SmartBlockNode) => ({
  type: "listItem" as const,
  children: [block],
});

const blocksFromItem = (item: SmartListNode["children"][number]): SmartBlockNode[] =>
  item.children.length ? item.children : [paragraph()];

const replaceContainerChildren = (
  document: SmartDocument,
  containerPath: Path,
  children: SmartBlockNode[],
) => {
  const container = getNodeAtPath(document, containerPath) as { children?: SmartBlockNode[] } | undefined;
  if (!container?.children) throw new Error("List selection does not resolve to a block container.");
  return replaceNodeAtPath(document, containerPath, { ...container, children });
};

const transformBlockRange = (
  document: SmartDocument,
  target: Extract<ListTarget, { kind: "range" }>,
  style: ListStyle,
  forceList = false,
): { document: SmartDocument; path: Path } => {
  const container = getNodeAtPath(document, target.containerPath) as { children?: SmartBlockNode[] } | undefined;
  if (!container?.children || target.start < 0 || target.end >= container.children.length) {
    throw new Error("Selected block range is out of bounds.");
  }
  const selected = container.children.slice(target.start, target.end + 1);
  const allSameStyleLists = selected.every((block) => block.type === "list" && block.style === style);
  const replacement = allSameStyleLists && !forceList
    ? selected.flatMap((block) =>
      block.type === "list" ? block.children.flatMap(blocksFromItem) : [block])
    : [{
      type: "list" as const,
      style,
      children: selected.flatMap((block) =>
        block.type === "list" ? block.children : [itemFromBlock(block)]),
    }];
  const children = [
    ...container.children.slice(0, target.start),
    ...replacement,
    ...container.children.slice(target.end + 1),
  ];
  return {
    document: replaceContainerChildren(document, target.containerPath, children),
    path: [...target.containerPath, target.start],
  };
};

const transformListItems = (
  document: SmartDocument,
  target: Extract<ListTarget, { kind: "items" }>,
  style: ListStyle,
): { document: SmartDocument; path: Path } => {
  const list = getNodeAtPath(document, target.listPath) as SmartListNode | undefined;
  if (!list || list.type !== "list" || target.start < 0 || target.end >= list.children.length) {
    throw new Error("Selected list-item range is out of bounds.");
  }
  const before = list.children.slice(0, target.start);
  const selected = list.children.slice(target.start, target.end + 1);
  const after = list.children.slice(target.end + 1);
  const parentPath = target.listPath.slice(0, -1);
  const listIndex = target.listPath[target.listPath.length - 1];
  const parent = getNodeAtPath(document, parentPath) as { children?: SmartBlockNode[] } | undefined;
  if (!parent?.children) throw new Error("List parent is not a block container.");

  const replacement: SmartBlockNode[] = [];
  if (before.length) replacement.push({ ...list, children: before });
  if (list.style === style) {
    replacement.push(...selected.flatMap(blocksFromItem));
  } else {
    replacement.push({ ...list, style, children: selected });
  }
  if (after.length) replacement.push({ ...list, children: after });
  const children = [
    ...parent.children.slice(0, listIndex),
    ...replacement,
    ...parent.children.slice(listIndex + 1),
  ];
  return {
    document: replaceContainerChildren(document, parentPath, children),
    path: [...parentPath, listIndex + (before.length ? 1 : 0)],
  };
};

const transformMixedRange = (
  document: SmartDocument,
  target: Extract<ListTarget, { kind: "mixed" }>,
  style: ListStyle,
) => {
  const container = getNodeAtPath(document, target.containerPath) as { children?: SmartBlockNode[] } | undefined;
  const source = getNodeAtPath(document, target.listPath) as SmartListNode | undefined;
  if (!container?.children || source?.type !== "list") throw new Error("Mixed list selection is invalid.");
  const selectedItems = source.children.slice(target.itemStart, target.itemEnd + 1);
  const mixedList: SmartListNode = {
    type: "list",
    style,
    children: [
      itemFromBlock(container.children[target.blockIndex]),
      ...selectedItems,
    ],
  };
  const remaining = source.children.filter((_, index) => index < target.itemStart || index > target.itemEnd);
  const replacement: SmartBlockNode[] = remaining.length > 0
    ? [mixedList, { ...source, children: remaining }]
    : [mixedList];
  const children = [...container.children];
  children.splice(Math.min(target.blockIndex, target.listPath[target.listPath.length - 1]), 2, ...replacement);
  return {
    document: replaceContainerChildren(document, target.containerPath, children),
    path: [...target.containerPath, Math.min(target.blockIndex, target.listPath[target.listPath.length - 1])],
  };
};

const cascadeListStyles = (list: SmartListNode, depth = 0): SmartListNode => {
  if (list.preset) {
    return {
      ...list,
      style: listStyleForPresetDepth(list.preset, depth),
      children: list.children.map((item) => ({
        ...item,
        children: item.children.map((child) =>
          child.type === "list"
            ? cascadeListStyles({ ...child, preset: list.preset }, depth + 1)
            : child),
      })),
    };
  }
  const ordered = ["decimal", "lower-alpha", "lower-roman", "upper-alpha", "upper-roman"] as const;
  const unordered = ["disc", "circle", "square"] as const;
  const orderedStyle = list.style === "decimal-leading-zero" || ordered.includes(list.style as typeof ordered[number]);
  const family = orderedStyle ? ordered : unordered;
  const style = depth === 0 ? list.style : family[Math.min(depth, family.length - 1)];
  return {
    ...list,
    style,
    children: list.children.map((item) => ({
      ...item,
      children: item.children.map((child) =>
        child.type === "list" ? cascadeListStyles({ ...child, style }, depth + 1) : child),
    })),
  };
};

export const toggleList: SmartCommand<ToggleListInput> = {
  id: "list.toggle",
  isEnabled: (context, input) => Boolean(input && resolveListTarget(context)),
  execute: (context, input) => {
    if (!input) throw new Error("list.toggle requires a list style.");
    const target = resolveListTarget(context);
    if (!target) throw new Error("list.toggle requires a compatible block selection.");
    const effectiveTarget: ListTarget =
      target.kind === "items" && input.scope !== "selected-items"
        ? {
          kind: "range",
          containerPath: target.listPath.slice(0, -1),
          start: target.listPath[target.listPath.length - 1],
          end: target.listPath[target.listPath.length - 1],
        }
        : target;
    const selectedNode = effectiveTarget.kind === "range" && effectiveTarget.start === effectiveTarget.end
      ? getNodeAtPath(context.document, [...effectiveTarget.containerPath, effectiveTarget.start])
      : null;
    if (
      input.checklist &&
      effectiveTarget.kind === "range" &&
      (selectedNode as SmartListNode | undefined)?.type === "list" &&
      (selectedNode as SmartListNode).checklist
    ) {
      const list = selectedNode as SmartListNode;
      const document = replaceNodeAtPath(
        context.document,
        [...effectiveTarget.containerPath, effectiveTarget.start],
        {
          ...list,
          checklist: undefined,
          strikeCompleted: undefined,
          children: list.children.map((item) => ({ ...item, checked: undefined })),
        },
      );
      return {
        id: "list.toggle",
        source: "user",
        operations: [{ type: "replaceNode", path: [], node: document }],
        selectionBefore: context.selection,
        selectionAfter: context.selection,
        addToHistory: true,
        timestamp: context.now?.() ?? Date.now(),
      };
    }
    let result = effectiveTarget.kind === "range"
      ? transformBlockRange(
        context.document,
        effectiveTarget,
        input.style,
        input.checklist || Boolean(input.preset),
      )
      : effectiveTarget.kind === "items"
        ? transformListItems(context.document, effectiveTarget, input.style)
        : transformMixedRange(context.document, effectiveTarget, input.style);
    if (input.preset) {
      const transformed = getNodeAtPath(result.document, result.path);
      if ((transformed as SmartListNode | undefined)?.type === "list") {
        const list = transformed as SmartListNode;
        result = {
          ...result,
          document: replaceNodeAtPath(result.document, result.path, {
            ...list,
            preset: input.preset,
            style: listStyleForPresetDepth(input.preset, 0),
          }),
        };
      }
    }
    if (input.checklist) {
      const transformed = getNodeAtPath(result.document, result.path);
      if ((transformed as SmartListNode | undefined)?.type === "list") {
        const list = transformed as SmartListNode;
        result = {
          ...result,
          document: replaceNodeAtPath(result.document, result.path, {
            ...list,
            checklist: true,
            ...(input.strikeCompleted ? { strikeCompleted: true } : {}),
            children: list.children.map((item) => ({
              ...item,
              checked: item.checked ?? false,
            })),
          }),
        };
      }
    }
    if (input.cascadeStyles) {
      const transformed = getNodeAtPath(result.document, result.path);
      if ((transformed as SmartListNode | undefined)?.type === "list") {
        result = {
          ...result,
          document: replaceNodeAtPath(
            result.document,
            result.path,
            cascadeListStyles(transformed as SmartListNode),
          ),
        };
      }
    }
    return {
      id: "list.toggle",
      source: "user",
      operations: [{ type: "replaceNode", path: [], node: result.document }],
      selectionBefore: context.selection,
      selectionAfter: { type: "node", path: result.path },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

const deepestListUnit = (
  document: SmartDocument,
  path: Path,
): { listPath: Path; itemIndex: number } | null => {
  let result: { listPath: Path; itemIndex: number } | null = null;
  for (let depth = 1; depth < path.length; depth += 1) {
    const listPath = path.slice(0, depth);
    const node = getNodeAtPath(document, listPath);
    if ((node as SmartListNode | undefined)?.type === "list" && Number.isInteger(path[depth])) {
      result = { listPath, itemIndex: path[depth] };
    }
  }
  return result;
};

const listItemTarget = (context: CommandContext): Extract<ListTarget, { kind: "items" }> | null => {
  const paths = selectionPaths(context.selection);
  if (!paths) return null;
  const anchor = deepestListUnit(context.document, paths[0]);
  const focus = deepestListUnit(context.document, paths[1]);
  if (!anchor || !focus || !samePath(anchor.listPath, focus.listPath)) return null;
  return {
    kind: "items",
    listPath: anchor.listPath,
    start: Math.min(anchor.itemIndex, focus.itemIndex),
    end: Math.max(anchor.itemIndex, focus.itemIndex),
  };
};

const listTransaction = (
  id: string,
  context: CommandContext,
  document: SmartDocument,
  selectionAfter: SmartSelection,
): SmartTransaction => ({
  id,
  source: "user",
  operations: [{ type: "replaceNode", path: [], node: document }],
  selectionBefore: context.selection,
  selectionAfter,
  addToHistory: true,
  timestamp: context.now?.() ?? Date.now(),
});

const pathStartsWith = (path: Path, prefix: Path) =>
  prefix.length <= path.length && prefix.every((part, index) => path[index] === part);

const mapSelectedTextItems = (
  selection: SmartSelection,
  listPath: Path,
  start: number,
  end: number,
  mapPath: (itemIndex: number, suffix: Path) => Path,
): SmartSelection | null => {
  if (selection.type !== "text") return null;
  const mapPoint = (point: typeof selection.anchor) => {
    if (!pathStartsWith(point.path, listPath) || point.path.length <= listPath.length) return null;
    const itemIndex = point.path[listPath.length];
    if (itemIndex < start || itemIndex > end) return null;
    return {
      path: mapPath(itemIndex, point.path.slice(listPath.length + 1)),
      offset: point.offset,
    };
  };
  const anchor = mapPoint(selection.anchor);
  const focus = mapPoint(selection.focus);
  return anchor && focus ? { type: "text", anchor, focus } : null;
};

export const indentListItems: SmartCommand<void> = {
  id: "list.indent",
  isEnabled: (context) => {
    const target = listItemTarget(context);
    return Boolean(target && target.start > 0);
  },
  execute: (context) => {
    const target = listItemTarget(context);
    if (!target || target.start === 0) {
      throw new Error("list.indent requires list items with a previous sibling.");
    }
    const list = getNodeAtPath(context.document, target.listPath) as SmartListNode;
    const previous = list.children[target.start - 1];
    const selected = list.children.slice(target.start, target.end + 1);
    const lastChild = previous.children[previous.children.length - 1];
    const existingNestedCount =
      lastChild?.type === "list" && lastChild.style === list.style
        ? lastChild.children.length
        : 0;
    const nested = lastChild?.type === "list" && lastChild.style === list.style
      ? { ...lastChild, children: [...lastChild.children, ...selected] }
      : { type: "list" as const, style: list.style, children: selected };
    const previousChildren = lastChild?.type === "list" && lastChild.style === list.style
      ? [...previous.children.slice(0, -1), nested]
      : [...previous.children, nested];
    const nextList: SmartListNode = {
      ...list,
      children: [
        ...list.children.slice(0, target.start - 1),
        { ...previous, children: previousChildren },
        ...list.children.slice(target.end + 1),
      ],
    };
    const document = replaceNodeAtPath(context.document, target.listPath, nextList);
    const selectionAfter = mapSelectedTextItems(
      context.selection,
      target.listPath,
      target.start,
      target.end,
      (itemIndex, suffix) => [
        ...target.listPath,
        target.start - 1,
        previousChildren.length - 1,
        existingNestedCount + itemIndex - target.start,
        ...suffix,
      ],
    ) || { type: "node" as const, path: [...target.listPath, target.start - 1, previousChildren.length - 1] };
    return listTransaction(
      "list.indent",
      context,
      document,
      selectionAfter,
    );
  },
};

export const outdentListItems: SmartCommand<void> = {
  id: "list.outdent",
  isEnabled: (context) => {
    const target = listItemTarget(context);
    if (!target || target.listPath.length < 3) return false;
    const parentItemPath = target.listPath.slice(0, -1);
    const parentItem = getNodeAtPath(context.document, parentItemPath);
    const ancestorList = getNodeAtPath(context.document, parentItemPath.slice(0, -1));
    return (parentItem as { type?: string } | undefined)?.type === "listItem" &&
      (ancestorList as { type?: string } | undefined)?.type === "list";
  },
  execute: (context) => {
    const target = listItemTarget(context);
    if (!target || !outdentListItems.isEnabled(context)) {
      throw new Error("list.outdent requires items in a nested list.");
    }
    const nestedList = getNodeAtPath(context.document, target.listPath) as SmartListNode;
    const parentItemPath = target.listPath.slice(0, -1);
    const parentItem = getNodeAtPath(context.document, parentItemPath) as SmartListNode["children"][number];
    const ancestorListPath = parentItemPath.slice(0, -1);
    const ancestorList = getNodeAtPath(context.document, ancestorListPath) as SmartListNode;
    const parentIndex = parentItemPath[parentItemPath.length - 1];
    const nestedIndex = target.listPath[target.listPath.length - 1];
    const selected = nestedList.children.slice(target.start, target.end + 1);
    const remaining = [
      ...nestedList.children.slice(0, target.start),
      ...nestedList.children.slice(target.end + 1),
    ];
    const nextParent = {
      ...parentItem,
      children: remaining.length
        ? [
          ...parentItem.children.slice(0, nestedIndex),
          { ...nestedList, children: remaining },
          ...parentItem.children.slice(nestedIndex + 1),
        ]
        : [
          ...parentItem.children.slice(0, nestedIndex),
          ...parentItem.children.slice(nestedIndex + 1),
        ],
    };
    const nextAncestor: SmartListNode = {
      ...ancestorList,
      children: [
        ...ancestorList.children.slice(0, parentIndex),
        nextParent,
        ...selected,
        ...ancestorList.children.slice(parentIndex + 1),
      ],
    };
    const document = replaceNodeAtPath(context.document, ancestorListPath, nextAncestor);
    const selectionAfter = mapSelectedTextItems(
      context.selection,
      target.listPath,
      target.start,
      target.end,
      (itemIndex, suffix) => [
        ...ancestorListPath,
        parentIndex + 1 + itemIndex - target.start,
        ...suffix,
      ],
    ) || { type: "node" as const, path: [...ancestorListPath, parentIndex + 1] };
    return listTransaction(
      "list.outdent",
      context,
      document,
      selectionAfter,
    );
  },
};

/**
 * Converts explicitly selected block nodes in one table cell into a single
 * list. No DOM ranges, wrappers, or React state participate in this command.
 */
export const toggleTableCellList = (
  document: SmartDocument,
  selection: SmartSelection,
  input: ToggleTableCellListInput
): CommandResult => {
  const table = getNodeAtPath(document, input.tablePath) as SmartTableNode | undefined;
  if (!table || table.type !== "table") throw new Error("Expected a table at tablePath.");

  const cell = table.children[input.row]?.children[input.column] as SmartTableCellNode | undefined;
  if (!cell || (cell.type !== "tableCell" && cell.type !== "tableHeaderCell")) {
    throw new Error("Expected a table cell at the requested coordinates.");
  }

  const indexes = [...new Set(input.blockIndexes)].sort((left, right) => left - right);
  if (indexes.length === 0) throw new Error("At least one table-cell block must be selected.");
  if (indexes.some((index) => index < 0 || index >= cell.children.length)) {
    throw new Error("Selected table-cell block index is out of bounds.");
  }

  const selected = indexes.map((index) => cell.children[index]) as SmartBlockNode[];
  const selectedIndexes = new Set(indexes);
  const firstIndex = indexes[0];
  const list = listFromBlocks(selected, input.style);
  const nextCell: SmartTableCellNode = {
    ...cell,
    children: cell.children.reduce<SmartBlockNode[]>((children, block, index) => {
      if (index === firstIndex) children.push(list);
      if (!selectedIndexes.has(index)) children.push(block);
      return children;
    }, []),
  };
  const cellPath = [...input.tablePath, input.row, input.column] as const;
  const nextDocument = replaceNodeAtPath(document, cellPath, nextCell);
  const listPath = [...cellPath, firstIndex] as const;
  const selectionAfter: SmartSelection = { type: "node", path: listPath };

  return {
    document: nextDocument,
    transaction: {
      id: "toggle-table-cell-list",
      source: "user",
      operations: [{ type: "replaceNode", path: cellPath, node: nextCell }],
      selectionBefore: selection,
      selectionAfter,
      addToHistory: true,
      timestamp: Date.now(),
    },
  };
};
