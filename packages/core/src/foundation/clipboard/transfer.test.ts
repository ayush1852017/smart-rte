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
