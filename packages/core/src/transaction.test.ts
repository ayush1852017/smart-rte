import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  paragraph,
  type SmartDocument,
  type SmartEditorState,
  type SmartOperation,
  type SmartSelection,
  type SmartTransaction,
} from "./index.js";

const selection: SmartSelection = {
  type: "text",
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [0, 0], offset: 0 },
};

const state = (...texts: string[]): SmartEditorState => ({
  document: { type: "doc", children: texts.map(paragraph) },
  selection,
});

const transaction = (
  operations: SmartOperation[],
  selectionAfter: SmartSelection = selection
): SmartTransaction => ({
  id: "test-transaction",
  source: "user",
  operations,
  selectionBefore: selection,
  selectionAfter,
  addToHistory: true,
  timestamp: 1,
});

const paragraphTexts = (document: SmartDocument) =>
  document.children.map((block) =>
    block.type === "paragraph" ? block.children.map((node) => node.text).join("") : block.type
  );

describe("applyTransaction", () => {
  it("inserts, removes, and replaces nodes without mutating the previous state", () => {
    const before = state("one", "two");
    const next = applyTransaction(
      before,
      transaction([
        { type: "insertNode", path: [1], node: paragraph("inserted") },
        { type: "removeNode", path: [2] },
        { type: "replaceNode", path: [0], node: paragraph("replaced") },
      ])
    );

    expect(paragraphTexts(next.document)).toEqual(["replaced", "inserted"]);
    expect(paragraphTexts(before.document)).toEqual(["one", "two"]);
    expect(next.document).not.toBe(before.document);
  });

  it("moves a node using destination coordinates from before the move", () => {
    const before = state("one", "two", "three", "four");
    const next = applyTransaction(
      before,
      transaction([{ type: "moveNode", from: [1], to: [4] }])
    );

    expect(paragraphTexts(next.document)).toEqual(["one", "three", "four", "two"]);
  });

  it("adjusts a destination parent shifted by removal", () => {
    const before: SmartEditorState = {
      document: {
        type: "doc",
        children: [
          paragraph("moving"),
          { type: "blockquote", children: [paragraph("first quote")] },
          { type: "blockquote", children: [paragraph("target")] },
        ],
      },
      selection,
    };
    const next = applyTransaction(
      before,
      transaction([{ type: "moveNode", from: [0], to: [2, 1] }])
    );
    expect(next.document.children).toHaveLength(2);
    const target = next.document.children[1];
    expect(target.type === "blockquote" && paragraphTexts({ type: "doc", children: target.children })).toEqual([
      "target",
      "moving",
    ]);
  });

  it("rejects moving a node into its own descendant", () => {
    const before: SmartEditorState = {
      document: {
        type: "doc",
        children: [{
          type: "blockquote",
          children: [paragraph("inside")],
        }],
      },
      selection,
    };

    expect(() =>
      applyTransaction(before, transaction([{ type: "moveNode", from: [0], to: [0, 0] }]))
    ).toThrow("own descendant");
    expect(before.document.children[0].type).toBe("blockquote");
  });

  it("splits and merges text nodes with compatible marks", () => {
    const before: SmartEditorState = {
      document: {
        type: "doc",
        children: [{
          type: "paragraph",
          children: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }],
        }],
      },
      selection,
    };
    const split = applyTransaction(
      before,
      transaction([{ type: "splitNode", path: [0, 0], position: 2 }])
    );
    const paragraphNode = split.document.children[0];
    expect(paragraphNode.type === "paragraph" && paragraphNode.children.map((node) => node.text)).toEqual(["he", "llo"]);

    const merged = applyTransaction(
      split,
      transaction([{ type: "mergeNode", path: [0, 1] }])
    );
    const mergedParagraph = merged.document.children[0];
    expect(mergedParagraph.type === "paragraph" && mergedParagraph.children).toEqual([
      { type: "text", text: "hello", marks: [{ type: "bold" }] },
    ]);
  });

  it("splits and merges compatible container nodes", () => {
    const before: SmartEditorState = {
      document: {
        type: "doc",
        children: [{
          type: "blockquote",
          alignment: "center",
          children: [paragraph("one"), paragraph("two")],
        }],
      },
      selection,
    };
    const split = applyTransaction(
      before,
      transaction([{ type: "splitNode", path: [0], position: 1 }])
    );
    expect(split.document.children).toHaveLength(2);

    const merged = applyTransaction(split, transaction([{ type: "mergeNode", path: [1] }]));
    const quote = merged.document.children[0];
    expect(quote.type === "blockquote" && paragraphTexts({ type: "doc", children: quote.children })).toEqual(["one", "two"]);
  });

  it("sets and removes non-structural attributes", () => {
    const before = state("one");
    const aligned = applyTransaction(
      before,
      transaction([{ type: "setNodeAttrs", path: [0], attrs: { alignment: "right" } }])
    );
    expect(aligned.document.children[0]).toMatchObject({ alignment: "right" });

    const cleared = applyTransaction(
      aligned,
      transaction([{ type: "setNodeAttrs", path: [0], attrs: { alignment: undefined } }])
    );
    expect(cleared.document.children[0]).not.toHaveProperty("alignment");
    expect(() =>
      applyTransaction(before, transaction([{ type: "setNodeAttrs", path: [0], attrs: { children: [] } }]))
    ).toThrow("structural");
  });

  it("replaces a text range while retaining its marks", () => {
    const before: SmartEditorState = {
      document: {
        type: "doc",
        children: [{
          type: "paragraph",
          children: [{ type: "text", text: "hello", marks: [{ type: "italic" }] }],
        }],
      },
      selection,
    };
    const next = applyTransaction(
      before,
      transaction([{ type: "replaceText", path: [0, 0], start: 1, end: 4, text: "i" }])
    );
    expect(next.document.children[0]).toEqual({
      type: "paragraph",
      children: [{ type: "text", text: "hio", marks: [{ type: "italic" }] }],
    });
  });

  it("applies explicit selection operations in order and returns selectionAfter", () => {
    const intermediate: SmartSelection = { type: "node", path: [0] };
    const finalSelection: SmartSelection = { type: "all" };
    const next = applyTransaction(
      state("one"),
      transaction([{ type: "setSelection", selection: intermediate }], finalSelection)
    );
    expect(next.selection).toEqual(finalSelection);
  });

  it("is failure-atomic from the caller's perspective", () => {
    const before = state("one");
    const snapshot = structuredClone(before);
    expect(() =>
      applyTransaction(
        before,
        transaction([
          { type: "insertNode", path: [1], node: paragraph("temporary") },
          { type: "removeNode", path: [99] },
        ])
      )
    ).toThrow("out of bounds");
    expect(before).toEqual(snapshot);
  });
});
