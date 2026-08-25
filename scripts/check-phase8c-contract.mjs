import { assertContract, readSource, sourceHas } from "./contract-utils.mjs";

const [
  tableCommands,
  foundationTest,
  blockCommandsTest,
  tableTest,
  listHistoryProperty,
  types,
  annotationsRange,
  annotationsTest,
] = await Promise.all([
  readSource("packages/core/src/foundation/table/commands.ts"),
  readSource("packages/core/src/foundation/foundation.test.ts"),
  readSource("packages/core/src/foundation/block/commands.test.ts"),
  readSource("packages/core/src/foundation/table/table.test.ts"),
  readSource("packages/core/src/foundation/list/history.property.test.ts"),
  readSource("packages/core/src/foundation/types.ts"),
  readSource("packages/core/src/foundation/annotations/range.ts"),
  readSource("packages/core/src/foundation/annotations/range.test.ts"),
]);
const failures = [];

// Assertion 1: node identity survives split, merge, move, type change, undo.
if (!sourceHas(foundationTest, /apply then invert is identity for %s/)) failures.push("Assertion 1: no apply/invert identity coverage for every operation type (foundation.test.ts).");
if (!sourceHas(foundationTest, /restores structure and exact IDs after 500 randomized structural sequences/)) failures.push("Assertion 1: no randomized structural-sequence identity property test (foundation.test.ts).");
if (!sourceHas(blockCommandsTest, /restores exact type, ID, attributes, marks, and reverse selection in 500 cases/)) failures.push("Assertion 1: no editor-level type-change undo/redo identity coverage (block/commands.test.ts).");
if (!sourceHas(blockCommandsTest, /preserves exact IDs and order across move-then-undo-then-redo/)) failures.push("Assertion 1: no editor-level move undo/redo identity coverage (block/commands.test.ts).");
if (!sourceHas(tableTest, /preserves a valid single-claim grid and exact undo state/)) failures.push("Assertion 1: no table split/merge/move undo identity coverage (table/table.test.ts).");
if (!sourceHas(listHistoryProperty, /restores exact IDs, list state, and reverse selection/)) failures.push("Assertion 1: no list editor-level undo/redo identity coverage (list/history.property.test.ts).");

// Assertion 2: every operation is granular - no operation replaces a
// subtree larger than the edit requires. The whole-table replaceTable
// helper this assertion used to be violated by is gone entirely; its
// absence is a stronger, more robust gate than checking each call site.
if (sourceHas(tableCommands, /replaceTable\s*\(/)) failures.push("Assertion 2: table/commands.ts still references a whole-table replaceTable helper.");
if (!sourceHas(tableTest, /operation\.before\.type\)\.not\.toBe\(\s*"table"\s*\)/)) failures.push("Assertion 2: no runtime assertion that table commands never emit a whole-table replaceNode (table/table.test.ts).");

// Assertion 3: selection maps through every operation type, associatively.
if (!sourceHas(foundationTest, /keeps mapped positions resolvable through %s/)) failures.push("Assertion 3: no per-operation-type resolvability coverage (foundation.test.ts).");
if (!sourceHas(foundationTest, /maps positions associatively for \[%s, insertText\] pairs/)) failures.push("Assertion 3: associativity is not checked for every operation type (foundation.test.ts).");

// Assertion 4: transactions are JSON-serializable and carry baseRevision
// (required) and authorId. authorId stays optional at the type level by
// deliberate choice (see docs/PHASE_ROADMAP_8B_12B.md / the Phase 8c plan) -
// the gate instead requires the plumbing that threads it through transact()
// to actually work end to end.
if (!sourceHas(types, /baseRevision:\s*number;/)) failures.push("Assertion 4: SmartTransaction.baseRevision is not a required field (types.ts).");
if (!sourceHas(types, /authorId\?:\s*string;/)) failures.push("Assertion 4: SmartTransaction.metadata.authorId is missing (types.ts).");
if (!sourceHas(foundationTest, /threads authorId from transact/)) failures.push("Assertion 4: no plumbing test for authorId reaching the emitted transaction (foundation.test.ts).");
if (!sourceHas(foundationTest, /assertTransactionSerializable/)) failures.push("Assertion 4: no serializability coverage (foundation.test.ts).");

// Assertion 5: every operation implements map(op, otherOp).
if (!sourceHas(foundationTest, /mapOperation maps %s through a concurrent operation without throwing/)) failures.push("Assertion 5: mapOperation is not exercised for every operation type (foundation.test.ts).");

// Assertion 6: annotation ranges survive arbitrary transaction sequences.
if (!sourceHas(annotationsRange, /export const resolveAnnotationRange/) || !sourceHas(annotationsRange, /export const rebaseAnnotationRange\b/)) {
  failures.push("Assertion 6: annotations/range.ts is missing the AnnotationRange primitive.");
}
if (!sourceHas(annotationsTest, /round-trips split -> rebase -> merge-undo -> rebase back to the original range in 500 cases/)) {
  failures.push("Assertion 6: no seeded property coverage of an AnnotationRange surviving a transaction sequence (annotations/range.test.ts).");
}

if (assertContract("Phase 8c collab-readiness", failures)) {
  process.stdout.write("Phase 8c contract: fine-grained table operations, per-transaction validity, an id-anchored annotation range primitive, and all six collab-readiness assertions have regression coverage.\n");
}
