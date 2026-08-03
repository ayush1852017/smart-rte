import { applyOperations, invertOperations } from "./operations.js";
import { isTextNode } from "./identity.js";
import { nodeAtPath, resolvePos } from "./positions.js";
import { validate } from "./schema.js";
import type { PersistedEditorDocument, SmartDocument, SmartSchema, SmartTransaction } from "./types.js";

export class StaleTransactionError extends Error {
  constructor(expected: number, actual: number) {
    super(`Stale transaction: base revision ${actual}, current revision ${expected}.`);
    this.name = "StaleTransactionError";
  }
}

export const invertTransaction = (transaction: SmartTransaction): SmartTransaction => ({
  id: `inverse:${transaction.id}`,
  baseRevision: transaction.baseRevision + 1,
  operations: invertOperations(transaction.operations),
  selectionBefore: structuredClone(transaction.selectionAfter),
  selectionAfter: structuredClone(transaction.selectionBefore),
  ...(transaction.storedMarksAfter ? { storedMarksBefore: structuredClone(transaction.storedMarksAfter) } : {}),
  ...(transaction.storedMarksBefore ? { storedMarksAfter: structuredClone(transaction.storedMarksBefore) } : {}),
  metadata: {
    ...structuredClone(transaction.metadata),
    source: "api",
    addToHistory: false,
  },
});

export const assertTransactionSerializable = (transaction: SmartTransaction): void => {
  const json = JSON.stringify(transaction);
  if (json === undefined) throw new Error("Transaction is not JSON-serializable.");
  const parsed = JSON.parse(json);
  if (JSON.stringify(parsed) !== json) throw new Error("Transaction is not stably JSON-serializable.");
};

export const applyTransactionAtomic = (
  state: PersistedEditorDocument,
  transaction: SmartTransaction,
  schema: SmartSchema,
): PersistedEditorDocument => {
  if (transaction.baseRevision !== state.revision) throw new StaleTransactionError(state.revision, transaction.baseRevision);
  assertTransactionSerializable(transaction);
  const document = applyOperations(state.document, transaction.operations);
  const textOnly = transaction.operations.every((operation) =>
    operation.type === "insertText" || operation.type === "deleteText" || operation.type === "addMark" || operation.type === "removeMark");
  const affectedPaths = [...new Set(transaction.operations.flatMap((operation) =>
    operation.type === "addMark" || operation.type === "removeMark"
      ? [JSON.stringify(operation.range.from.path), JSON.stringify(operation.range.to.path)]
      : "pos" in operation ? [JSON.stringify(operation.pos.path)] : []))];
  const errors = textOnly
    ? affectedPaths.flatMap((pathJson) => {
      const node = nodeAtPath(document, JSON.parse(pathJson) as number[]);
      if (!node || isTextNode(node)) return [{ path: JSON.parse(pathJson) as number[], code: "invalid-text-owner", message: "Text operation owner no longer exists." }];
      return validate({ type: "doc", id: "local-validation-root", children: [node] }, schema)
        .filter((error) => error.path.length > 0);
    })
    : validate(document, schema);
  if (errors.length) throw new Error(`Transaction produced an invalid document: ${errors[0].message}`);
  resolvePos(document, transaction.selectionAfter.anchor);
  resolvePos(document, transaction.selectionAfter.head);
  return { schemaVersion: schema.version, revision: state.revision + 1, document };
};

export const documentsEqual = (left: SmartDocument, right: SmartDocument) =>
  JSON.stringify(left) === JSON.stringify(right);
