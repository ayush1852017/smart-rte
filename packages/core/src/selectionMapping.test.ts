import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  mapSelectionThroughOperation,
  paragraph,
  type LegacySmartDocument,
  type SmartEditorState,
  type LegacySmartOperation,
  type LegacySmartSelection,
  type LegacySmartTransaction,
} from "./index.js";

const document: LegacySmartDocument = {
  type: "doc",
  children: [
    paragraph("one"),
    {
      type: "blockquote",
      children: [paragraph("inside"), paragraph("second")],
    },
    paragraph("three"),
  ],
};

const pointSelection = (path: readonly number[], offset: number): LegacySmartSelection => ({
  type: "text",
  anchor: { path, offset },
  focus: { path, offset },
});

describe("selection mapping", () => {
  it("shifts paths after insertions and removals", () => {
    const selection = pointSelection([2, 0], 2);
    const inserted = mapSelectionThroughOperation(
      selection,
      { type: "insertNode", path: [1], node: paragraph("inserted") },
      document
    );
    expect(inserted).toEqual(pointSelection([3, 0], 2));

    const removed = mapSelectionThroughOperation(
      selection,
      { type: "removeNode", path: [0] },
      document
    );
    expect(removed).toEqual(pointSelection([1, 0], 2));
  });

  it("falls back to the removed node's parent when selected content is deleted", () => {
    const mapped = mapSelectionThroughOperation(
      pointSelection([1, 0, 0], 3),
      { type: "removeNode", path: [1, 0] },
      document
    );
    expect(mapped).toEqual({ type: "node", path: [1] });

    expect(mapSelectionThroughOperation(
      { type: "node", path: [1, 0] },
      { type: "removeNode", path: [1] },
      document
    )).toEqual({ type: "node", path: [] });
  });

  it("keeps a selection attached to a moved subtree", () => {
    const mapped = mapSelectionThroughOperation(
      pointSelection([1, 1, 0], 2),
      { type: "moveNode", from: [1], to: [3] },
      document
    );
    expect(mapped).toEqual(pointSelection([2, 1, 0], 2));
  });

  it("maps text points across a split boundary", () => {
    const before = pointSelection([0, 0], 2);
    const after = pointSelection([0, 0], 3);
    const operation: LegacySmartOperation = { type: "splitNode", path: [0, 0], position: 2 };

    expect(mapSelectionThroughOperation(before, operation, document)).toEqual(pointSelection([0, 0], 2));
    expect(mapSelectionThroughOperation(after, operation, document)).toEqual(pointSelection([0, 1], 1));
  });

  it("maps descendants to the right side of a container split", () => {
    const mapped = mapSelectionThroughOperation(
      pointSelection([1, 1, 0], 2),
      { type: "splitNode", path: [1], position: 1 },
      document
    );
    expect(mapped).toEqual(pointSelection([2, 0, 0], 2));
  });

  it("maps points from merged text and container nodes", () => {
    const textDocument: LegacySmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      }],
    };
    expect(mapSelectionThroughOperation(
      pointSelection([0, 1], 2),
      { type: "mergeNode", path: [0, 1] },
      textDocument
    )).toEqual(pointSelection([0, 0], 5));

    expect(mapSelectionThroughOperation(
      pointSelection([1, 1, 0], 2),
      { type: "mergeNode", path: [1] },
      {
        type: "doc",
        children: [
          { type: "blockquote", children: [paragraph("left")] },
          { type: "blockquote", children: [paragraph("right one"), paragraph("right two")] },
        ],
      }
    )).toEqual(pointSelection([0, 2, 0], 2));
  });

  it("maps offsets through text replacement", () => {
    const operation: LegacySmartOperation = {
      type: "replaceText",
      path: [0, 0],
      start: 1,
      end: 3,
      text: "replacement",
    };
    expect(mapSelectionThroughOperation(pointSelection([0, 0], 0), operation, document))
      .toEqual(pointSelection([0, 0], 0));
    expect(mapSelectionThroughOperation(pointSelection([0, 0], 2), operation, document))
      .toEqual(pointSelection([0, 0], 12));
    expect(mapSelectionThroughOperation(pointSelection([0, 0], 3), operation, document))
      .toEqual(pointSelection([0, 0], 12));
  });

  it("maps points through the text-node splits created by mark operations", () => {
    const operation: LegacySmartOperation = {
      type: "addMark",
      path: [0, 0],
      start: 1,
      end: 3,
      mark: { type: "bold" },
    };
    expect(mapSelectionThroughOperation(pointSelection([0, 0], 2), operation, document))
      .toEqual(pointSelection([0, 1], 1));
    expect(mapSelectionThroughOperation(pointSelection([0, 0], 3), operation, document))
      .toEqual(pointSelection([0, 1], 2));
  });

  it("maps table paths while retaining cell coordinates", () => {
    const selection: LegacySmartSelection = {
      type: "cell",
      tablePath: [2],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 1 },
    };
    expect(mapSelectionThroughOperation(
      selection,
      { type: "insertNode", path: [1], node: paragraph("before table") },
      document
    )).toEqual({ ...selection, tablePath: [3] });
  });

  it("uses automatic mapping only when selectionAfter is omitted", () => {
    const initial = pointSelection([1, 1, 0], 2);
    const state: SmartEditorState = { document, selection: initial };
    const autoTransaction: LegacySmartTransaction = {
      id: "auto-map",
      source: "user",
      operations: [{ type: "moveNode", from: [1], to: [3] }],
      selectionBefore: initial,
      addToHistory: true,
      timestamp: 1,
    };
    expect(applyTransaction(state, autoTransaction).selection).toEqual(pointSelection([2, 1, 0], 2));

    const explicit: LegacySmartSelection = { type: "all" };
    expect(applyTransaction(state, { ...autoTransaction, selectionAfter: explicit }).selection).toEqual(explicit);
  });
});
