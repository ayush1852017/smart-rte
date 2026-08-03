import { invertTransaction } from "./transactions.js";
import type { HistoryEntry, SmartHistory, SmartOperation, SmartTransaction } from "./types.js";

export const DEFAULT_HISTORY_LIMIT = 200;
export const DEFAULT_COALESCENCE_WINDOW_MS = 400;

export const createHistory = (options: { limit?: number; coalescenceWindowMs?: number } = {}): SmartHistory => ({
  undo: [],
  redo: [],
  limit: Math.max(1, Math.floor(options.limit ?? DEFAULT_HISTORY_LIMIT)),
  coalescenceWindowMs: Math.max(0, options.coalescenceWindowMs ?? DEFAULT_COALESCENCE_WINDOW_MS),
});

const typingTail = (transaction: SmartTransaction): SmartOperation & { type: "insertText" } | null => {
  if (!transaction.operations.length || transaction.operations.some((operation) => operation.type !== "insertText")) return null;
  return transaction.operations[transaction.operations.length - 1] as SmartOperation & { type: "insertText" };
};

const equalPos = (left: { path: number[]; offset: number }, right: { path: number[]; offset: number }) =>
  left.offset === right.offset && left.path.length === right.path.length && left.path.every((part, index) => part === right.path[index]);

const canCoalesce = (previous: SmartTransaction, next: SmartTransaction, windowMs: number): boolean => {
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

const entryFor = (transaction: SmartTransaction): HistoryEntry => ({
  forward: structuredClone(transaction),
  inverse: invertTransaction(transaction),
  estimatedBytes: JSON.stringify(transaction).length,
});

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
  if (undo.length > history.limit) undo.splice(0, undo.length - history.limit);
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
