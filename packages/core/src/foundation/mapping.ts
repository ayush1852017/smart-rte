import { mapPosThroughOperation } from "./operations.js";
import type { SmartOperation, SmartPos, SmartRange, SmartSelection, SmartTransaction, TransactionMap } from "./types.js";

export class FoundationTransactionMap implements TransactionMap {
  private readonly operations: readonly SmartOperation[];
  private readonly deletedKeys = new Set<string>();

  constructor(transactionOrOperations: SmartTransaction | readonly SmartOperation[]) {
    this.operations = "operations" in transactionOrOperations
      ? transactionOrOperations.operations
      : transactionOrOperations;
  }

  map(pos: SmartPos, bias: -1 | 1 = 1): SmartPos {
    let current = { path: [...pos.path], offset: pos.offset };
    let wasDeleted = false;
    this.operations.forEach((operation) => {
      const result = mapPosThroughOperation(current, operation, bias);
      current = result.pos;
      wasDeleted ||= result.deleted;
    });
    if (wasDeleted) this.deletedKeys.add(JSON.stringify(pos));
    return current;
  }

  mapRange(range: SmartRange): SmartRange {
    return { from: this.map(range.from, -1), to: this.map(range.to, 1) };
  }

  mapSelection(selection: SmartSelection): SmartSelection {
    return { ...selection, anchor: this.map(selection.anchor, -1), head: this.map(selection.head, 1) };
  }

  deleted(pos: SmartPos): boolean {
    if (this.deletedKeys.has(JSON.stringify(pos))) return true;
    let current = pos;
    for (const operation of this.operations) {
      const result = mapPosThroughOperation(current, operation);
      if (result.deleted) return true;
      current = result.pos;
    }
    return false;
  }
}

export const createTransactionMap = (transactionOrOperations: SmartTransaction | readonly SmartOperation[]): TransactionMap =>
  new FoundationTransactionMap(transactionOrOperations);
