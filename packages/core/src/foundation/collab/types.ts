import type { SmartOperation, SmartTransaction } from "../types.js";

export type MoveNodeOperation = Extract<SmartOperation, { type: "moveNode" }>;
export type RemoveNodeOperation = Extract<SmartOperation, { type: "removeNode" }>;
export type ReplaceNodeOperation = Extract<SmartOperation, { type: "replaceNode" }>;

/**
 * Result of transforming one operation through a single concurrent
 * "through" operation - `mapOperation` (operations.ts) only ever returns
 * `SmartOperation | null`, collapsing "target no longer exists, this
 * operation is now a harmless no-op" and "target was folded into something
 * else and this operation cannot be safely, precisely redirected" into the
 * same `null`. Concurrent rebase needs to tell those apart: the first is
 * routine and silent, the second must be surfaced (per this phase's stop
 * condition 4 - a rebase must never silently corrupt state or silently
 * drop a conflicting edit without saying so).
 */
export type TransformResult =
  | { kind: "ok"; operation: SmartOperation }
  | { kind: "dropped" }
  | { kind: "conflict"; reason: string };

/** Rebasing a whole transaction through everything committed since its baseRevision. */
export type RebaseResult =
  | { kind: "ok"; transaction: SmartTransaction }
  /** Every operation in the transaction turned out to be a no-op against the current state (e.g. it only edited content someone else already deleted outright). Nothing to apply; the transaction is simply dropped. */
  | { kind: "dropped" }
  /** At least one operation could not be safely transformed - see `reasons` for which operation (by index) and why. The transaction as a whole is rejected; the caller decides what happens to the user's edit (see rebaseTransaction's own doc comment). */
  | { kind: "conflict"; reasons: readonly { operationIndex: number; reason: string }[] }
  /** `sinceRevision` predates what this client has retained - a transform can't be attempted at all without the missing history. The caller must resync (reload the full document at the current revision) rather than attempt a partial rebase. */
  | { kind: "resync-required"; atRevision: number };
