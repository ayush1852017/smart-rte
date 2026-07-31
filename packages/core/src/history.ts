import type { Path, SmartDocument, SmartTextNode } from "./model.js";
import { mapSelectionThroughOperation } from "./selectionMapping.js";
import type { SmartSelection } from "./selection.js";
import { normalizeSmartDocument } from "./schema.js";
import {
  applyOperationToState,
  applyTransaction,
  getMoveDestinationAfterRemoval,
  type SmartEditorState,
  type SmartOperation,
  type SmartTransaction,
} from "./transaction.js";
import { getNodeAtTreePath, isSmartContainer } from "./tree.js";

export interface HistoryEntry {
  forward: SmartTransaction;
  inverse: SmartTransaction;
}

export interface SmartHistoryState {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  limit: number;
}

export interface HistoryResult {
  state: SmartEditorState;
  history: SmartHistoryState;
  applied: boolean;
}

export const createHistoryState = (limit = 100): SmartHistoryState => ({
  undo: [],
  redo: [],
  limit: Math.max(1, Math.floor(limit)),
});

const parentPath = (path: Path) => path.slice(0, -1);

const inverseForOperation = (
  document: SmartDocument,
  selection: SmartSelection,
  operation: SmartOperation
): SmartOperation[] => {
  if (operation.type === "insertNode") return [{ type: "removeNode", path: operation.path }];
  if (operation.type === "removeNode") {
    return [{ type: "insertNode", path: operation.path, node: getNodeAtTreePath(document, operation.path) }];
  }
  if (operation.type === "replaceNode") {
    return [{ type: "replaceNode", path: operation.path, node: getNodeAtTreePath(document, operation.path) }];
  }
  if (operation.type === "moveNode") {
    const movedNode = getNodeAtTreePath(document, operation.from);
    const destination = getMoveDestinationAfterRemoval(operation.from, operation.to);
    return [
      { type: "removeNode", path: destination },
      { type: "insertNode", path: operation.from, node: movedNode },
    ];
  }
  if (operation.type === "splitNode") {
    const rightPath = [
      ...parentPath(operation.path),
      operation.path[operation.path.length - 1] + 1,
    ];
    return [{ type: "mergeNode", path: rightPath }];
  }
  if (operation.type === "mergeNode") {
    const leftPath = [
      ...parentPath(operation.path),
      operation.path[operation.path.length - 1] - 1,
    ];
    const left = getNodeAtTreePath(document, leftPath);
    const position = (left as { type?: unknown })?.type === "text"
      ? (left as SmartTextNode).text.length
      : isSmartContainer(left)
        ? left.children.length
        : 0;
    return [{ type: "splitNode", path: leftPath, position }];
  }
  if (operation.type === "setNodeAttrs") {
    const node = getNodeAtTreePath(document, operation.path) as Record<string, unknown>;
    const attrs = Object.fromEntries(
      Object.keys(operation.attrs).map((name) => [name, Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined])
    );
    return [{ type: "setNodeAttrs", path: operation.path, attrs }];
  }
  if (operation.type === "replaceText") {
    const node = getNodeAtTreePath(document, operation.path) as SmartTextNode;
    return [{
      type: "replaceText",
      path: operation.path,
      start: operation.start,
      end: operation.start + operation.text.length,
      text: node.text.slice(operation.start, operation.end),
    }];
  }
  if (operation.type === "addMark" || operation.type === "removeMark") {
    const path = parentPath(operation.path);
    return [{ type: "replaceNode", path, node: getNodeAtTreePath(document, path) }];
  }
  return [{ type: "setSelection", selection }];
};

export const invertTransaction = (
  state: SmartEditorState,
  transaction: SmartTransaction
): SmartTransaction => {
  let document = state.document;
  let selection = state.selection;
  const inverseGroups: SmartOperation[][] = [];

  transaction.operations.forEach((operation) => {
    inverseGroups.unshift(inverseForOperation(document, selection, operation));
    const before = document;
    const next = applyOperationToState(document, selection, operation);
    document = next.document;
    selection = operation.type === "setSelection"
      ? next.selection
      : mapSelectionThroughOperation(selection, operation, before);
  });

  return {
    id: `undo:${transaction.id}`,
    source: "history",
    operations: inverseGroups.flat(),
    selectionBefore: transaction.selectionAfter ?? selection,
    selectionAfter: state.selection,
    addToHistory: false,
    timestamp: transaction.timestamp,
  };
};

export const applyTransactionWithHistory = (
  state: SmartEditorState,
  history: SmartHistoryState,
  transaction: SmartTransaction
): HistoryResult => {
  let inverse = invertTransaction(state, transaction);
  const nextState = applyTransaction(state, transaction);
  const restored = applyTransaction(nextState, inverse);
  const expectedDocument = normalizeSmartDocument(state.document);
  if (
    JSON.stringify(restored.document) !== JSON.stringify(expectedDocument) ||
    JSON.stringify(restored.selection) !== JSON.stringify(state.selection)
  ) {
    inverse = {
      ...inverse,
      operations: [{ type: "replaceNode", path: [], node: expectedDocument }],
      selectionAfter: state.selection,
    };
  }
  if (!transaction.addToHistory) {
    return { state: nextState, history, applied: true };
  }
  const previous = history.undo[history.undo.length - 1];
  const canGroup = Boolean(
    transaction.historyGroup &&
    previous?.forward.historyGroup === transaction.historyGroup
  );
  const entry: HistoryEntry = canGroup
    ? {
        forward: {
          ...previous.forward,
          operations: [...previous.forward.operations, ...transaction.operations],
          selectionAfter: transaction.selectionAfter ?? nextState.selection,
          timestamp: transaction.timestamp,
        },
        inverse: {
          ...inverse,
          operations: [...inverse.operations, ...previous.inverse.operations],
          selectionBefore: transaction.selectionAfter ?? nextState.selection,
          selectionAfter: previous.inverse.selectionAfter,
        },
      }
    : { forward: transaction, inverse };
  const undo = canGroup
    ? [...history.undo.slice(0, -1), entry]
    : [...history.undo, entry];
  if (undo.length > history.limit) undo.splice(0, undo.length - history.limit);
  return {
    state: nextState,
    history: { ...history, undo, redo: [] },
    applied: true,
  };
};

export const undoHistory = (
  state: SmartEditorState,
  history: SmartHistoryState
): HistoryResult => {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return { state, history, applied: false };
  return {
    state: applyTransaction(state, entry.inverse),
    history: {
      ...history,
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, entry],
    },
    applied: true,
  };
};

export const redoHistory = (
  state: SmartEditorState,
  history: SmartHistoryState
): HistoryResult => {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return { state, history, applied: false };
  return {
    state: applyTransaction(state, entry.forward),
    history: {
      ...history,
      undo: [...history.undo, entry],
      redo: history.redo.slice(0, -1),
    },
    applied: true,
  };
};
