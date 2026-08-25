import { describe, expect, it } from "vitest";
import {
  acceptStructuralSuggestionCommand,
  applyOperations,
  createScopeIndex,
  foundationSchema,
  mergeTableCellsCommand,
  occupancyGridFor,
  rebaseStructuralSuggestionsThroughTransaction,
  resolveAnnotationRange,
  structuralSuggestionFromNode,
  type SmartDocument,
  type SmartElementNode,
  type SmartOperation,
  type SmartSelection,
  type SmartTransaction,
  type TableGridScope,
} from "../index.js";

const noneSelection: SmartSelection = { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
const tx = (operations: SmartOperation[]): SmartTransaction => ({
  id: "tx", baseRevision: 0, operations, selectionBefore: noneSelection, selectionAfter: noneSelection,
  metadata: { source: "api", timestamp: 0, addToHistory: true },
});
const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });

describe("Phase 12a §2.3 - structural suggestions (AnnotationRange-based)", () => {
  it("structuralSuggestionFromNode anchors both endpoints to the node id", () => {
    const suggestion = structuralSuggestionFromNode("p1", "alice");
    expect(suggestion).toMatchObject({ authorId: "alice", kind: "removeNode", range: { startId: "p1", endId: "p1" } });
    expect(typeof suggestion.id).toBe("string");
  });

  describe("acceptStructuralSuggestionCommand", () => {
    it("removes the proposed node", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [p("keep", "a"), p("gone", "b")] };
      const suggestion = structuralSuggestionFromNode("gone", "alice");
      const positions = createScopeIndex().positions(document, foundationSchema);
      const operations = acceptStructuralSuggestionCommand(document, suggestion, positions);
      expect(operations).toEqual([{ type: "removeNode", pos: { path: [], offset: 1 }, node: p("gone", "b") }]);
      expect(applyOperations(document, operations).children.map((child) => (child as SmartElementNode).id)).toEqual(["keep"]);
    });

    it("is a no-op once the target node no longer resolves", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [p("keep", "a")] };
      const suggestion = structuralSuggestionFromNode("already-gone", "alice");
      const positions = createScopeIndex().positions(document, foundationSchema);
      expect(acceptStructuralSuggestionCommand(document, suggestion, positions)).toEqual([]);
    });
  });

  describe("rebaseStructuralSuggestionsThroughTransaction", () => {
    it("leaves suggestions unchanged through a transaction with no operations", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello")] };
      const suggestions = [structuralSuggestionFromNode("p1", "alice")];
      expect(rebaseStructuralSuggestionsThroughTransaction(suggestions, document, tx([]), foundationSchema)).toBe(suggestions);
    });

    it("snaps a suggestion anchored to a cell absorbed by a real table merge to the surviving anchor cell", () => {
      const cell = (id: string, text: string): SmartElementNode => ({ type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false }, children: [p(`${id}-p`, text)] });
      const row = (id: string, cells: SmartElementNode[]): SmartElementNode => ({ type: "table_row", id, children: cells });
      const table: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [row("r0", [cell("a", "A"), cell("b", "B")])] };
      const document: SmartDocument = { type: "doc", id: "doc", children: [table] };
      const grid = occupancyGridFor(table);
      const whole: TableGridScope = {
        kind: "table-grid", tableId: "table", rect: { top: 0, left: 0, bottom: 0, right: 1 },
        cellIds: grid.anchors.map((entry) => entry.cellId), coveredCellIds: [], rectangular: true,
        range: { from: { path: [0, 0, 0, 0], offset: 0 }, to: { path: [0, 0, 1, 0], offset: 0 } },
        isolatingAncestorId: null, clamped: false,
      };
      const ctx = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
      const operations = mergeTableCellsCommand(document, whole, {}, ctx);
      const suggestions = [structuralSuggestionFromNode("b", "alice")];
      const result = rebaseStructuralSuggestionsThroughTransaction(suggestions, document, tx(operations), foundationSchema);
      expect(result[0].range).toEqual({ startId: "a", startOffset: undefined, endId: "a", endOffset: undefined });
    });

    it("keeps reference identity for a suggestion unaffected by the transaction", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "a"), p("p2", "b")] };
      const unrelated = structuralSuggestionFromNode("p1", "alice");
      const suggestions = [unrelated, structuralSuggestionFromNode("p2", "alice")];
      const operation: SmartOperation = { type: "insertText", pos: { path: [1], offset: 0 }, text: "X" };
      const result = rebaseStructuralSuggestionsThroughTransaction(suggestions, document, tx([operation]), foundationSchema);
      expect(result[0]).toBe(unrelated);
    });

    it("survives a real cross-block Backspace merge (deleteAcrossBlock), snapped to the surviving paragraph", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [p("survivor", "hello"), p("removed", "world")] };
      // Mirrors surface/input.ts's deleteAcrossBlock output directly, since
      // that is a private method on the input pipeline - same op shape
      // exercised end-to-end by the real beforeinput dispatch in
      // phase2_5.test.ts and the comments e2e spec.
      const merged: SmartElementNode = { ...p("survivor"), children: [{ type: "text", text: "helloworld" }] };
      const operations: SmartOperation[] = [
        { type: "replaceNode", pos: { path: [], offset: 0 }, before: document.children[0], after: merged },
        { type: "removeNode", pos: { path: [], offset: 1 }, node: document.children[1], mergedInto: "survivor" },
      ];
      const suggestions = [structuralSuggestionFromNode("removed", "alice")];
      const result = rebaseStructuralSuggestionsThroughTransaction(suggestions, document, tx(operations), foundationSchema);
      expect(result[0].range).toEqual({ startId: "survivor", startOffset: undefined, endId: "survivor", endOffset: undefined });
      const after = applyOperations(document, operations);
      const positions = createScopeIndex().positions(after, foundationSchema);
      expect(resolveAnnotationRange(result[0].range, positions)).not.toBeNull();
    });
  });
});
