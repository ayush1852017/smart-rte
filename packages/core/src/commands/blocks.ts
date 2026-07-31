import type { SmartCommand } from "../command.js";
import {
  getNodeAtPath,
  paragraph,
  type Path,
  type SmartBlockNode,
  type SmartHeadingNode,
} from "../model.js";
import { isSmartContainer } from "../tree.js";

export interface SetBlockTypeInput {
  parentPath: Path;
  blockIndexes: readonly number[];
  type: "paragraph" | "heading";
  level?: SmartHeadingNode["level"];
}

const selectedSiblingBlocks = (
  context: Parameters<SmartCommand<SetBlockTypeInput>["isEnabled"]>[0],
  parentPath: Path,
  indexes: readonly number[],
) => {
  const parent = getNodeAtPath(context.document, parentPath);
  const unique = [...new Set(indexes)].sort((a, b) => a - b);
  if (!isSmartContainer(parent) || !unique.length) return null;
  if (unique.some((index) => index < 0 || index >= parent.children.length)) return null;
  return { parent, indexes: unique };
};

export const setBlockType: SmartCommand<SetBlockTypeInput> = {
  id: "block-type.set",
  isEnabled: (context, input) => {
    if (!input || input.type === "heading" &&
      (!Number.isInteger(input.level) || (input.level || 0) < 1 || (input.level || 0) > 6)) return false;
    const selected = selectedSiblingBlocks(context, input.parentPath, input.blockIndexes);
    return Boolean(selected && selected.indexes.every((index) => {
      const type = (selected.parent.children[index] as { type?: string }).type;
      return type === "paragraph" || type === "heading";
    }));
  },
  execute: (context, input) => {
    if (!input || !setBlockType.isEnabled(context, input)) {
      throw new Error("block-type.set requires paragraph or heading sibling blocks.");
    }
    const selected = selectedSiblingBlocks(context, input.parentPath, input.blockIndexes)!;
    const indexSet = new Set(selected.indexes);
    const children = selected.parent.children.map((node, index) => {
      if (!indexSet.has(index)) return node;
      const block = node as Extract<SmartBlockNode, { type: "paragraph" | "heading" }>;
      return input.type === "paragraph"
        ? { type: "paragraph" as const, ...(block.alignment ? { alignment: block.alignment } : {}), children: block.children }
        : {
          type: "heading" as const,
          level: input.level!,
          ...(block.alignment ? { alignment: block.alignment } : {}),
          children: block.children.map((child) => {
            if (child.type !== "text") return child;
            const marks = child.marks?.filter((mark) => mark.type !== "fontSize");
            return marks?.length
              ? { ...child, marks }
              : { type: "text" as const, text: child.text };
          }),
        };
    });
    return {
      id: "block-type.set",
      source: "user",
      operations: [{
        type: "replaceNode",
        path: input.parentPath,
        node: { ...(selected.parent as object), children },
      }],
      selectionBefore: context.selection,
      selectionAfter: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export interface ToggleBlockquoteInput {
  parentPath: Path;
  blockIndexes: readonly number[];
}

export const toggleBlockquote: SmartCommand<ToggleBlockquoteInput> = {
  id: "blockquote.toggle",
  isEnabled: (context, input) => {
    const selected = input && selectedSiblingBlocks(context, input.parentPath, input.blockIndexes);
    if (!selected) return false;
    return selected.indexes.every((index, offset) =>
      offset === 0 || index === selected.indexes[offset - 1] + 1);
  },
  execute: (context, input) => {
    if (!input || !toggleBlockquote.isEnabled(context, input)) {
      throw new Error("blockquote.toggle requires contiguous sibling blocks.");
    }
    const selected = selectedSiblingBlocks(context, input.parentPath, input.blockIndexes)!;
    const first = selected.indexes[0];
    const last = selected.indexes[selected.indexes.length - 1];
    const blocks = selected.parent.children.slice(first, last + 1) as SmartBlockNode[];
    const replacement = blocks.every((block) => block.type === "blockquote")
      ? blocks.flatMap((block) => block.type === "blockquote" ? block.children : [block])
      : [{ type: "blockquote" as const, children: blocks.length ? blocks : [paragraph()] }];
    return {
      id: "blockquote.toggle",
      source: "user",
      operations: [{
        type: "replaceNode",
        path: input.parentPath,
        node: {
          ...(selected.parent as object),
          children: [
            ...selected.parent.children.slice(0, first),
            ...replacement,
            ...selected.parent.children.slice(last + 1),
          ],
        },
      }],
      selectionBefore: context.selection,
      selectionAfter: { type: "node", path: [...input.parentPath, first] },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};
