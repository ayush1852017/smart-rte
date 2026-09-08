import { describe, expect, it } from "vitest";
import { applyOperations } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartSelection } from "../types.js";
import { deleteClipboardSelection, sliceClipboardSelection } from "./transfer.js";

const document: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "paragraph", id: "a", children: [{ type: "text", text: "alpha" }] },
  { type: "paragraph", id: "b", children: [{ type: "text", text: "beta" }] },
] };
const selection: SmartSelection = { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [1], offset: 2 } };

describe("clipboard copy/cut model helpers", () => {
  it("slices partial endpoint blocks without mutating the source", () => {
    const before = structuredClone(document);
    expect(JSON.stringify(sliceClipboardSelection(document, selection))).toContain("pha");
    expect(JSON.stringify(sliceClipboardSelection(document, selection))).toContain("be");
    expect(document).toEqual(before);
  });

  it("deletes the same range as one operation batch", () => {
    const positions = createScopeIndex().positions(document, foundationSchema);
    const result = deleteClipboardSelection(document, selection, positions);
    const after = applyOperations(document, result.operations);
    expect(after.children).toHaveLength(1);
    const remaining = after.children[0] as { children: Array<{ text?: string }> };
    expect(remaining.children.map((node) => node.text || "").join("")).toBe("alta");
  });
});

describe("clipboard copy/cut across endpoints with no shared immediate parent", () => {
  // Regression for a real, everyday selection - starting in a plain paragraph
  // and dragging into a nested list item - throwing "Clipboard copy is clamped
  // to one structural parent." as an uncaught error instead of copying/cutting.
  const nestedDocument: SmartDocument = { type: "doc", id: "doc", children: [
    { type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] },
    { type: "list", id: "l", attrs: { kind: "bullet" }, children: [
      { type: "list_item", id: "i0", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "one" }] }] },
      { type: "list_item", id: "i1", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "two" }] }] },
      { type: "list_item", id: "i2", children: [{ type: "paragraph", id: "p2", children: [{ type: "text", text: "three" }] }] },
    ] },
  ] };
  // "he|llo" ... list item 0 fully covered ... "tw|o": selects "llo", all of item0, "tw".
  const crossingSelection: SmartSelection = {
    type: "text", anchor: { path: [0], offset: 2 }, head: { path: [1, 1, 0], offset: 2 },
  };

  it("slices content spanning into a nested list item instead of throwing", () => {
    const before = structuredClone(nestedDocument);
    const sliced = sliceClipboardSelection(nestedDocument, crossingSelection);
    expect(nestedDocument).toEqual(before);
    expect(sliced.children).toHaveLength(2);
    const [first, list] = sliced.children as Array<{ children: Array<{ text?: string; children?: Array<{ text?: string }> }> }>;
    expect(first.children.map((node) => node.text || "").join("")).toBe("llo");
    expect((list as unknown as { children: unknown[] }).children).toHaveLength(2);
    const lastItemParagraph = (list as unknown as { children: Array<{ children: Array<{ text?: string }> }> }).children[1].children[0];
    expect(lastItemParagraph.children.map((node) => node.text || "").join("")).toBe("tw");
  });

  it("deletes content spanning into a nested list item instead of throwing, trimming both endpoints without merging them", () => {
    const positions = createScopeIndex().positions(nestedDocument, foundationSchema);
    const result = deleteClipboardSelection(nestedDocument, crossingSelection, positions);
    const after = applyOperations(nestedDocument, result.operations);
    expect(after.children).toHaveLength(2);
    const paragraph = after.children[0] as { children: Array<{ text?: string }> };
    expect(paragraph.children.map((node) => node.text || "").join("")).toBe("he");
    const list = after.children[1] as { children: Array<{ children: Array<{ children: Array<{ text?: string }> }> }> };
    expect(list.children).toHaveLength(2);
    expect(list.children[0].children[0].children.map((node) => node.text || "").join("")).toBe("o");
  });
});
