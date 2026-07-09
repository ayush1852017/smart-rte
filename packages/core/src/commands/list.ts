import {
  getNodeAtPath,
  type Path,
  type SmartBlockNode,
  type SmartDocument,
  type SmartListNode,
  type SmartTableCellNode,
  type SmartTableNode,
} from "../model.js";
import { listFromBlocks } from "../table.js";
import { replaceNodeAtPath } from "../tree.js";
import type { SmartSelection } from "../selection.js";
import type { SmartTransaction } from "../transaction.js";

export type ListStyle = SmartListNode["style"];

export interface ToggleTableCellListInput {
  tablePath: Path;
  row: number;
  column: number;
  blockIndexes: readonly number[];
  style: ListStyle;
}

export interface CommandResult {
  document: SmartDocument;
  transaction: SmartTransaction;
}

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
