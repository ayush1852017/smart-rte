import type { SmartCommand } from "../command.js";
import type { Path } from "../model.js";
import { getNodeAtTreePath, isSmartContainer } from "../tree.js";

export interface MoveBlocksInput {
  parentPath: Path;
  blockIndexes: readonly number[];
  direction: "up" | "down";
}

export interface IndentBlocksInput {
  parentPath: Path;
  blockIndexes: readonly number[];
  direction: "indent" | "outdent";
}

const normalizedIndexes = (indexes: readonly number[]) => {
  const result = [...new Set(indexes)].sort((left, right) => left - right);
  if (!result.length || result.some((index) => !Number.isInteger(index) || index < 0)) return undefined;
  if (result.some((index, position) => position > 0 && index !== result[position - 1] + 1)) return undefined;
  return result;
};

const resolveSiblingRange = (
  context: Parameters<SmartCommand["isEnabled"]>[0],
  parentPath: Path,
  indexes: readonly number[],
) => {
  const normalized = normalizedIndexes(indexes);
  if (!normalized) return undefined;
  try {
    const parent = getNodeAtTreePath(context.document, parentPath);
    if (!isSmartContainer(parent) || normalized[normalized.length - 1] >= parent.children.length) return undefined;
    return { parent, indexes: normalized };
  } catch {
    return undefined;
  }
};

export const moveBlocks: SmartCommand<MoveBlocksInput> = {
  id: "block.move",
  isEnabled: (context, input) => {
    if (!input) return false;
    const range = resolveSiblingRange(context, input.parentPath, input.blockIndexes);
    if (!range) return false;
    return input.direction === "up"
      ? range.indexes[0] > 0
      : range.indexes[range.indexes.length - 1] < range.parent.children.length - 1;
  },
  execute: (context, input) => {
    if (!input || !moveBlocks.isEnabled(context, input)) {
      throw new Error("block.move requires a movable contiguous sibling range.");
    }
    const indexes = normalizedIndexes(input.blockIndexes)!;
    const first = indexes[0];
    const last = indexes[indexes.length - 1];
    return {
      id: "move-blocks",
      source: "user",
      operations: input.direction === "up"
        ? [{ type: "moveNode", from: [...input.parentPath, first - 1], to: [...input.parentPath, last + 1] }]
        : [{ type: "moveNode", from: [...input.parentPath, last + 1], to: [...input.parentPath, first] }],
      selectionBefore: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export const indentBlocks: SmartCommand<IndentBlocksInput> = {
  id: "block.indent",
  isEnabled: (context, input) => {
    if (!input) return false;
    const range = resolveSiblingRange(context, input.parentPath, input.blockIndexes);
    if (!range) return false;
    return range.indexes.some((index) => {
      const indent = Number((range.parent.children[index] as { indent?: number }).indent) || 0;
      return input.direction === "indent" ? indent < 10 : indent > 0;
    });
  },
  execute: (context, input) => {
    if (!input || !indentBlocks.isEnabled(context, input)) {
      throw new Error("block.indent requires a sibling range whose indentation can change.");
    }
    const range = resolveSiblingRange(context, input.parentPath, input.blockIndexes)!;
    return {
      id: "indent-blocks",
      source: "user",
      operations: range.indexes.flatMap((index) => {
        const indent = Number((range.parent.children[index] as { indent?: number }).indent) || 0;
        const nextIndent = input.direction === "indent"
          ? Math.min(indent + 1, 10)
          : Math.max(indent - 1, 0);
        return nextIndent === indent
          ? []
          : [{ type: "setNodeAttrs" as const, path: [...input.parentPath, index], attrs: { indent: nextIndent || undefined } }];
      }),
      selectionBefore: context.selection,
      selectionAfter: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};
