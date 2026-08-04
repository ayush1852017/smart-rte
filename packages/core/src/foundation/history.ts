import { invertTransaction } from "./transactions.js";
import { isTextNode } from "./identity.js";
import type { Attrs, HistoryEntry, SmartHistory, SmartNode, SmartOperation, SmartTransaction } from "./types.js";

export const DEFAULT_HISTORY_LIMIT = 200;
export const DEFAULT_HISTORY_BYTE_LIMIT = 32 * 1024 * 1024;
export const DEFAULT_COALESCENCE_WINDOW_MS = 400;

export const createHistory = (options: { limit?: number; byteLimit?: number; coalescenceWindowMs?: number } = {}): SmartHistory => ({
  undo: [],
  redo: [],
  limit: Math.max(1, Math.floor(options.limit ?? DEFAULT_HISTORY_LIMIT)),
  byteLimit: Math.max(1, Math.floor(options.byteLimit ?? DEFAULT_HISTORY_BYTE_LIMIT)),
  coalescenceWindowMs: Math.max(0, options.coalescenceWindowMs ?? DEFAULT_COALESCENCE_WINDOW_MS),
});

const typingTail = (transaction: SmartTransaction): SmartOperation & { type: "insertText" } | null => {
  if (!transaction.operations.length || transaction.operations.some((operation) => operation.type !== "insertText")) return null;
  return transaction.operations[transaction.operations.length - 1] as SmartOperation & { type: "insertText" };
};

const equalPos = (left: { path: number[]; offset: number }, right: { path: number[]; offset: number }) =>
  left.offset === right.offset && left.path.length === right.path.length && left.path.every((part, index) => part === right.path[index]);

const canCoalesce = (previous: SmartTransaction, next: SmartTransaction, windowMs: number): boolean => {
  if (previous.metadata.historyGroup || next.metadata.historyGroup) {
    return Boolean(previous.metadata.historyGroup && previous.metadata.historyGroup === next.metadata.historyGroup);
  }
  if (previous.metadata.compositionId || next.metadata.compositionId) {
    return Boolean(previous.metadata.compositionId && previous.metadata.compositionId === next.metadata.compositionId);
  }
  const left = typingTail(previous);
  const right = next.operations.length === 1 ? typingTail(next) : null;
  return Boolean(
    left && right &&
    previous.metadata.source === next.metadata.source &&
    previous.metadata.source === "input" &&
    next.metadata.timestamp - previous.metadata.timestamp >= 0 &&
    next.metadata.timestamp - previous.metadata.timestamp <= windowMs &&
    equalPos(previous.selectionAfter.anchor, next.selectionBefore.anchor) &&
    equalPos(previous.selectionAfter.head, next.selectionBefore.head) &&
    equalPos({ path: left.pos.path, offset: left.pos.offset + left.text.length }, right.pos),
  );
};

const entryFor = (transaction: SmartTransaction): HistoryEntry => {
  const forward = structuredClone(transaction);
  const inverse = invertTransaction(transaction);
  return { forward, inverse, estimatedBytes: JSON.stringify(forward).length + JSON.stringify(inverse).length };
};

const evictToBudget = (entries: HistoryEntry[], limit: number, byteLimit: number): HistoryEntry[] => {
  if (entries.length > limit) entries.splice(0, entries.length - limit);
  let bytes = entries.reduce((total, entry) => total + entry.estimatedBytes, 0);
  // Keep the newest intent even when it alone exceeds the budget so undo never
  // becomes unavailable immediately after a large paste or table operation.
  while (entries.length > 1 && bytes > byteLimit) bytes -= entries.shift()!.estimatedBytes;
  return entries;
};

export const recordHistory = (history: SmartHistory, transaction: SmartTransaction): SmartHistory => {
  if (!transaction.metadata.addToHistory) return history;
  const undo = [...history.undo];
  const previous = undo[undo.length - 1];
  if (previous && canCoalesce(previous.forward, transaction, history.coalescenceWindowMs)) {
    const combined: SmartTransaction = {
      ...previous.forward,
      operations: [...previous.forward.operations, ...structuredClone(transaction.operations)],
      selectionAfter: structuredClone(transaction.selectionAfter),
      storedMarksAfter: structuredClone(transaction.storedMarksAfter),
      metadata: { ...previous.forward.metadata, timestamp: transaction.metadata.timestamp },
    };
    undo[undo.length - 1] = entryFor(combined);
  } else undo.push(entryFor(transaction));
  evictToBudget(undo, history.limit, history.byteLimit);
  return { ...history, undo, redo: [] };
};

export const popUndo = (history: SmartHistory): { entry: HistoryEntry; history: SmartHistory } | null => {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return null;
  return { entry, history: { ...history, undo: history.undo.slice(0, -1), redo: [...history.redo, entry] } };
};

export const popRedo = (history: SmartHistory): { entry: HistoryEntry; history: SmartHistory } | null => {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return null;
  return { entry, history: { ...history, redo: history.redo.slice(0, -1), undo: [...history.undo, entry] } };
};

const rewriteNodeAttrs = (node: SmartNode, nodeId: string, before: Attrs, after: Attrs): SmartNode => {
  if (isTextNode(node)) return node;
  const children = node.children?.map((child) => rewriteNodeAttrs(child, nodeId, before, after));
  if (node.id !== nodeId) return children ? { ...node, children } : node;
  if (JSON.stringify(node.attrs || {}) !== JSON.stringify(before)) return children ? { ...node, children } : node;
  const { attrs: _attrs, ...rest } = node;
  return Object.keys(after).length ? { ...rest, attrs: structuredClone(after), ...(children ? { children } : {}) } : { ...rest, ...(children ? { children } : {}) };
};

/** Keeps stored undo/redo payloads applicable through non-history async state updates. */
export const rebaseHistoryNodeAttributes = (history: SmartHistory, nodeId: string, before: Attrs, after: Attrs): SmartHistory => {
  const transaction = (value: SmartTransaction): SmartTransaction => ({
    ...value,
    operations: value.operations.map((operation) => {
      if (operation.type === "insertNode" || operation.type === "removeNode") return { ...operation, node: rewriteNodeAttrs(operation.node, nodeId, before, after) };
      if (operation.type === "replaceNode") return {
        ...operation,
        before: rewriteNodeAttrs(operation.before, nodeId, before, after),
        after: rewriteNodeAttrs(operation.after, nodeId, before, after),
      };
      return operation;
    }),
  });
  const entry = (value: HistoryEntry): HistoryEntry => {
    const forward = transaction(value.forward);
    const inverse = transaction(value.inverse);
    return { forward, inverse, estimatedBytes: JSON.stringify(forward).length + JSON.stringify(inverse).length };
  };
  return {
    ...history,
    undo: evictToBudget(history.undo.map(entry), history.limit, history.byteLimit),
    redo: evictToBudget(history.redo.map(entry), history.limit, history.byteLimit),
  };
};
