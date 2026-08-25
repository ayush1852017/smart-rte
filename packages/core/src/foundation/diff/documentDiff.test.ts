import { describe, expect, it } from "vitest";
import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartElementNode } from "../types.js";
import { diffDocuments } from "./documentDiff.js";

const paragraph = (id: string, text: string): SmartElementNode => ({
  type: "paragraph", id, children: text ? [{ type: "text", text }] : [],
});
const doc = (children: SmartElementNode[]): SmartDocument => ({ type: "doc", id: "doc", children });

describe("diffDocuments", () => {
  it("reports no changes when diffing a document against itself", () => {
    const model = doc([paragraph("p1", "Alpha"), paragraph("p2", "Beta")]);
    expect(diffDocuments(model, model, foundationSchema)).toEqual({ added: [], removed: [], changed: [] });
    expect(diffDocuments(model, structuredClone(model), foundationSchema)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("reports an added paragraph as a single topmost entry", () => {
    const before = doc([paragraph("p1", "Alpha")]);
    const after = doc([paragraph("p1", "Alpha"), paragraph("p2", "Beta")]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.added).toEqual([{ kind: "added", nodeId: "p2", node: paragraph("p2", "Beta"), parentId: "doc", path: [1] }]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("reports a removed paragraph as a single topmost entry, not one entry per descendant", () => {
    const before = doc([paragraph("p1", "Alpha"), paragraph("p2", "Beta")]);
    const after = doc([paragraph("p1", "Alpha")]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.removed).toEqual([{ kind: "removed", nodeId: "p2", node: paragraph("p2", "Beta"), parentId: "doc", path: [1] }]);
    expect(result.added).toEqual([]);
  });

  it("reports a type change", () => {
    const before = doc([{ type: "paragraph", id: "p1", children: [{ type: "text", text: "Alpha" }] }]);
    const after = doc([{ type: "heading", id: "p1", attrs: { level: 1 }, children: [{ type: "text", text: "Alpha" }] }]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "p1", typeChange: { before: "paragraph", after: "heading" },
      attrsChange: { before: {}, after: { level: 1 }, changedKeys: ["level"] },
    }]);
  });

  it("reports an attrs change with only the changed keys listed", () => {
    const before: SmartElementNode = { type: "heading", id: "h1", attrs: { level: 1, align: "left" }, children: [{ type: "text", text: "Title" }] };
    const after: SmartElementNode = { type: "heading", id: "h1", attrs: { level: 2, align: "left" }, children: [{ type: "text", text: "Title" }] };
    const result = diffDocuments(doc([before]), doc([after]), foundationSchema);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "h1",
      attrsChange: { before: { level: 1, align: "left" }, after: { level: 2, align: "left" }, changedKeys: ["level"] },
    }]);
  });

  it("reports a word-level content change on a retained paragraph", () => {
    const before = doc([paragraph("p1", "hello world")]);
    const after = doc([paragraph("p1", "hello brave world")]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "p1",
      contentChange: [
        { op: "equal", text: "hello ", marks: [] },
        { op: "insert", text: "brave ", marks: [] },
        { op: "equal", text: "world", marks: [] },
      ],
    }]);
  });

  it("detects a cross-parent move", () => {
    const before = doc([
      { type: "list_item", id: "li1", children: [paragraph("p1", "Item")] },
      { type: "list_item", id: "li2", children: [] },
    ]);
    const after = doc([
      { type: "list_item", id: "li1", children: [] },
      { type: "list_item", id: "li2", children: [paragraph("p1", "Item")] },
    ]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "p1",
      move: { fromParentId: "li1", toParentId: "li2", fromPath: [0, 0], toPath: [1, 0] },
    }]);
  });

  it("detects a same-parent reorder", () => {
    const before = doc([paragraph("p1", "A"), paragraph("p2", "B"), paragraph("p3", "C")]);
    const after = doc([paragraph("p3", "C"), paragraph("p1", "A"), paragraph("p2", "B")]);
    const result = diffDocuments(before, after, foundationSchema);
    // p1/p2 kept their relative order to each other; only p3 actually moved.
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "p3",
      move: { fromParentId: "doc", toParentId: "doc", fromPath: [2], toPath: [0] },
    }]);
  });

  it("does not report a move for a retained node whose numeric index shifted only because a sibling was inserted or removed around it", () => {
    const before = doc([paragraph("p1", "A"), paragraph("p2", "B")]);
    const after = doc([paragraph("p0", "New"), paragraph("p1", "A"), paragraph("p2", "B")]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.added).toEqual([{ kind: "added", nodeId: "p0", node: paragraph("p0", "New"), parentId: "doc", path: [0] }]);
    // p1 and p2 both shifted index by +1, but neither reordered relative to
    // each other or to anything else retained - no `changed` entries at all.
    expect(result.changed).toEqual([]);
  });

  it("computes no diff at all for a table whose row/column commands only ever touch cell-level operations", () => {
    const cell = (id: string, text: string): SmartElementNode => ({
      type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false }, children: [paragraph(`${id}-p`, text)],
    });
    const table = (bText: string): SmartElementNode => ({
      type: "table", id: "t1", children: [{ type: "table_row", id: "r1", children: [cell("a", "A"), cell("b", bText)] }],
    });
    const before = doc([table("B")]);
    const after = doc([table("B changed")]);
    const result = diffDocuments(before, after, foundationSchema);
    expect(result.changed).toEqual([{
      kind: "changed", nodeId: "b-p",
      contentChange: [
        { op: "equal", text: "B ", marks: [] },
        { op: "insert", text: "changed", marks: [] },
      ],
    }]);
  });
});
