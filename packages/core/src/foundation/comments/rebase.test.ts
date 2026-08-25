import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { resolveAnnotationRange } from "../annotations/range.js";
import type { AnnotationRange } from "../annotations/types.js";
import { mergeTableCellsCommand, occupancyGridFor } from "../table/index.js";
import type { TableGridScope } from "../scope/types.js";
import type { SmartDocument, SmartElementNode, SmartOperation, SmartSelection, SmartTransaction } from "../types.js";
import { neverOrphanCommentPolicy, rebaseCommentThreadsThroughTransaction } from "./rebase.js";
import type { CommentThread } from "./types.js";
import type { MergeNodeOperation } from "../annotations/types.js";

const noneSelection: SmartSelection = { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
const tx = (operations: SmartOperation[]): SmartTransaction => ({
  id: "tx", baseRevision: 0, operations, selectionBefore: noneSelection, selectionAfter: noneSelection,
  metadata: { source: "api", timestamp: 0, addToHistory: true },
});
const thread = (id: string, range: AnnotationRange, resolved = false): CommentThread => ({
  id, range, resolved, replies: [{ id: `${id}-r1`, authorId: "a", text: "hello", createdAt: 0 }],
});
const ctx = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });

const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const cell = (id: string, text: string): SmartElementNode => ({ type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false }, children: [p(`${id}-p`, text)] });
const row = (id: string, cells: SmartElementNode[]): SmartElementNode => ({ type: "table_row", id, children: cells });

describe("rebaseCommentThreadsThroughTransaction", () => {
  it("leaves threads unchanged through a transaction with no operations", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello")] };
    const threads = [thread("t1", { startId: "p1", startOffset: 0, endId: "p1", endOffset: 1 })];
    expect(rebaseCommentThreadsThroughTransaction(threads, model, tx([]), foundationSchema)).toBe(threads);
  });

  it("leaves a thread anchored to an unrelated node untouched by an unrelated edit", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello"), p("p2", "world")] };
    const threads = [thread("t1", { startId: "p2", startOffset: 0, endId: "p2", endOffset: 1 })];
    const operation: SmartOperation = { type: "insertText", pos: { path: [0], offset: 0 }, text: "X" };
    const result = rebaseCommentThreadsThroughTransaction(threads, model, tx([operation]), foundationSchema);
    expect(result[0].range).toEqual(threads[0].range);
  });

  it("snaps a thread anchored to a cell absorbed by a table merge to the surviving anchor cell", () => {
    const table: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
      row("r0", [cell("a", "A"), cell("b", "B")]),
    ] };
    const model: SmartDocument = { type: "doc", id: "doc", children: [table] };
    const grid = occupancyGridFor(table);
    const whole: TableGridScope = {
      kind: "table-grid", tableId: "table", rect: { top: 0, left: 0, bottom: 0, right: 1 },
      cellIds: grid.anchors.map((entry) => entry.cellId), coveredCellIds: [], rectangular: true,
      range: { from: { path: [0, 0, 0, 0], offset: 0 }, to: { path: [0, 0, 1, 0], offset: 0 } },
      isolatingAncestorId: null, clamped: false,
    };
    const operations = mergeTableCellsCommand(model, whole, {}, ctx(model));
    const threads = [thread("t1", { startId: "b", endId: "b" })];
    const result = rebaseCommentThreadsThroughTransaction(threads, model, tx(operations), foundationSchema);
    expect(result[0].range).toEqual({ startId: "a", startOffset: undefined, endId: "a", endOffset: undefined });
  });

  it("leaves other threads' ranges reference-identical when only one thread is affected", () => {
    const table: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
      row("r0", [cell("a", "A"), cell("b", "B")]),
    ] };
    const model: SmartDocument = { type: "doc", id: "doc", children: [table] };
    const grid = occupancyGridFor(table);
    const whole: TableGridScope = {
      kind: "table-grid", tableId: "table", rect: { top: 0, left: 0, bottom: 0, right: 1 },
      cellIds: grid.anchors.map((entry) => entry.cellId), coveredCellIds: [], rectangular: true,
      range: { from: { path: [0, 0, 0, 0], offset: 0 }, to: { path: [0, 0, 1, 0], offset: 0 } },
      isolatingAncestorId: null, clamped: false,
    };
    const operations = mergeTableCellsCommand(model, whole, {}, ctx(model));
    const unrelated = thread("unrelated", { startId: "a", startOffset: 0, endId: "a", endOffset: 1 });
    const threads = [unrelated, thread("t1", { startId: "b", endId: "b" })];
    const result = rebaseCommentThreadsThroughTransaction(threads, model, tx(operations), foundationSchema);
    expect(result[0]).toBe(unrelated);
    expect(result[1].range).not.toEqual(threads[1].range);
  });

  it("neverOrphanCommentPolicy keeps the range's ids unchanged (never nulls it) when there is no sensible survivor to snap to", () => {
    // A single top-level paragraph with nothing preceding it - Backspace at
    // its own start has nothing to merge into, an edge case
    // defaultMergeOrphanPolicy itself returns null for. There is no way to
    // construct a real mergeNode operation for this shape (applyOperation's
    // own validation requires two genuinely adjacent siblings - see
    // operations.ts), so this exercises the policy function directly rather
    // than routing a hand-built operation through the full apply pipeline.
    const model: SmartDocument = { type: "doc", id: "doc", children: [p("only", "text")] };
    const range: AnnotationRange = { startId: "only", endId: "only" };
    const operation: MergeNodeOperation = { type: "mergeNode", pos: { path: [], offset: 0 }, depth: 0, retiredId: "only", splitOffset: 0 };
    const positions = createScopeIndex().positions(model, foundationSchema);
    const result = neverOrphanCommentPolicy(model)(range, operation, positions);
    // Ids preserved exactly (thread data never lost)...
    expect(result).toEqual(range);
    // ...but genuinely orphaned once "only" is actually gone from the document.
    const after = { type: "doc" as const, id: "doc", children: [] as SmartElementNode[] };
    expect(resolveAnnotationRange(result, createScopeIndex().positions(after, foundationSchema))).toBeNull();
  });

  it("rebases through a real multi-operation transaction correctly, replaying intermediate document states", () => {
    // Two operations in one transaction: first an unrelated insertText,
    // then a table merge. The merge's own PositionLookup must reflect the
    // document *after* the first operation, not the transaction's
    // original starting document - this is exactly what per-operation
    // replay must get right.
    const table: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
      row("r0", [cell("a", "A"), cell("b", "B")]),
    ] };
    const model: SmartDocument = { type: "doc", id: "doc", children: [p("above", "x"), table] };
    const grid = occupancyGridFor(table);
    const whole: TableGridScope = {
      kind: "table-grid", tableId: "table", rect: { top: 0, left: 0, bottom: 0, right: 1 },
      cellIds: grid.anchors.map((entry) => entry.cellId), coveredCellIds: [], rectangular: true,
      range: { from: { path: [1, 0, 0, 0], offset: 0 }, to: { path: [1, 0, 1, 0], offset: 0 } },
      isolatingAncestorId: null, clamped: false,
    };
    const mergeOps = mergeTableCellsCommand(model, whole, {}, ctx(model));
    const insertOp: SmartOperation = { type: "insertText", pos: { path: [0], offset: 0 }, text: "Y" };
    const threads = [thread("t1", { startId: "b", endId: "b" })];
    const result = rebaseCommentThreadsThroughTransaction(threads, model, tx([insertOp, ...mergeOps]), foundationSchema);
    expect(result[0].range).toEqual({ startId: "a", startOffset: undefined, endId: "a", endOffset: undefined });
  });
});
