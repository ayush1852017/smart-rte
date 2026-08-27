import { FoundationTransactionMap } from "../mapping.js";
import type { SmartOperation, SmartTransaction } from "../types.js";
import { transformOperation } from "./transform.js";
import type { RebaseResult } from "./types.js";

/**
 * Deterministic total order for the exact-tie case (see mapOperation's own
 * tieBreakBias doc comment) - lexicographic authorId comparison, computed
 * once per (local, remote) transaction pair so every operation pair within
 * that pairing agrees. Falls back to `1` (mapOperation's existing default)
 * when either side has no authorId, matching this codebase's convention
 * that authorId is optional (single-writer/no-transport usage never sets
 * it, and never hits a real tie to begin with).
 */
const tieBreakBias = (localAuthorId: string | undefined, remoteAuthorId: string | undefined): -1 | 1 => {
  if (!localAuthorId || !remoteAuthorId || localAuthorId === remoteAuthorId) return 1;
  return localAuthorId < remoteAuthorId ? -1 : 1;
};

/**
 * Rebases `transaction` (whose `baseRevision` is behind the current
 * revision) through every transaction committed since, in commit order.
 * Each of `transaction`'s own operations is threaded through every
 * operation of every missed transaction in sequence - the standard
 * single-step operational-transform composition, built on `mapOperation`/
 * `transformOperation`.
 *
 * Atomic per transaction: if any one operation conflicts, the whole
 * transaction is rejected as a conflict rather than partially applied -
 * matching `applyTransactionAtomic`'s own existing all-or-nothing
 * semantics, and avoiding a confusing state where only part of a user's
 * intent materializes.
 *
 * Does not check retention/resync - `missed` is whatever the caller
 * supplies; a caller backed by a bounded revision log is responsible for
 * returning `resync-required` itself before ever calling this when the
 * requested history has already been evicted (see editor.ts's dispatch).
 *
 * `newBaseRevision` is the revision the rebased transaction should be
 * stamped with (i.e. the live revision the caller is about to apply
 * against) - taken explicitly from the caller rather than inferred from
 * `missed`'s own entries, so a gap or reordering bug in how the caller
 * assembled `missed` can't silently produce a wrong revision stamp here.
 */
export const rebaseTransaction = (transaction: SmartTransaction, missed: readonly SmartTransaction[], newBaseRevision: number): RebaseResult => {
  if (!missed.length) return { kind: "ok", transaction: { ...transaction, baseRevision: newBaseRevision } };
  const conflicts: { operationIndex: number; reason: string }[] = [];
  const rebasedOperations: (SmartOperation | null)[] = transaction.operations.map((operation, operationIndex) => {
    let current: SmartOperation | null = operation;
    for (const remote of missed) {
      if (current === null) break;
      const bias = tieBreakBias(transaction.metadata.authorId, remote.metadata.authorId);
      for (const through of remote.operations) {
        if (current === null) break;
        const result = transformOperation(current, through, { tieBreakBias: bias });
        if (result.kind === "conflict") {
          conflicts.push({ operationIndex, reason: result.reason });
          current = null;
        } else {
          current = result.kind === "dropped" ? null : result.operation;
        }
      }
    }
    return current;
  });
  if (conflicts.length) return { kind: "conflict", reasons: conflicts };
  const survivors = rebasedOperations.filter((operation): operation is SmartOperation => operation !== null);
  if (!survivors.length) return { kind: "dropped" };
  const missedOperations = missed.flatMap((remote) => remote.operations);
  const selectionMap = new FoundationTransactionMap(missedOperations);
  const rebased: SmartTransaction = {
    ...transaction,
    baseRevision: newBaseRevision,
    operations: survivors,
    selectionBefore: selectionMap.mapSelection(transaction.selectionBefore),
    selectionAfter: selectionMap.mapSelection(transaction.selectionAfter),
  };
  return { kind: "ok", transaction: rebased };
};
