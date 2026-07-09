import { getNodeAtPath, paragraph, type Path, type SmartBlockNode, type SmartCodeBlockNode, type SmartDocument } from "../model.js";
import type { SmartSelection } from "../selection.js";
import type { SmartTransaction } from "../transaction.js";
import { isSmartContainer, replaceNodeAtPath } from "../tree.js";

export interface ToggleCodeBlocksInput {
  parentPath: Path;
  blockIndexes: readonly number[];
}

export interface CodeCommandResult {
  document: SmartDocument;
  transaction: SmartTransaction;
}

const toCodeBlock = (block: SmartBlockNode): SmartCodeBlockNode => {
  if (block.type === "codeBlock") return block;
  if (block.type === "paragraph" || block.type === "heading") {
    return {
      type: "codeBlock",
      text: block.children.map((child) => child.text).join(""),
    };
  }
  throw new Error(`Cannot convert ${block.type} to a code block.`);
};

const toParagraph = (block: SmartBlockNode) =>
  block.type === "codeBlock" ? paragraph(block.text) : block;

/** Converts selected sibling blocks only; neighbours are never inferred or changed. */
export const toggleCodeBlocks = (
  document: SmartDocument,
  selection: SmartSelection,
  input: ToggleCodeBlocksInput
): CodeCommandResult => {
  const parent = getNodeAtPath(document, input.parentPath);
  if (!isSmartContainer(parent)) throw new Error("Expected a block container at parentPath.");

  const indexes = [...new Set(input.blockIndexes)].sort((left, right) => left - right);
  if (indexes.length === 0) throw new Error("At least one block must be selected.");
  if (indexes.some((index) => index < 0 || index >= parent.children.length)) {
    throw new Error("Selected block index is out of bounds.");
  }

  const selected = indexes.map((index) => parent.children[index] as SmartBlockNode);
  const toggleOff = selected.every((block) => block.type === "codeBlock");
  const selectedIndexes = new Set(indexes);
  const nextParent = {
    ...(parent as object),
    children: parent.children.map((block, index) => {
      if (!selectedIndexes.has(index)) return block;
      return toggleOff
        ? toParagraph(block as SmartBlockNode)
        : toCodeBlock(block as SmartBlockNode);
    }),
  };
  const nextDocument = replaceNodeAtPath(document, input.parentPath, nextParent);
  const selectionAfter: SmartSelection = {
    type: "node",
    path: [...input.parentPath, indexes[0]],
  };

  return {
    document: nextDocument,
    transaction: {
      id: "toggle-code-blocks",
      source: "user",
      operations: [{ type: "replaceNode", path: input.parentPath, node: nextParent }],
      selectionBefore: selection,
      selectionAfter,
      addToHistory: true,
      timestamp: Date.now(),
    },
  };
};
