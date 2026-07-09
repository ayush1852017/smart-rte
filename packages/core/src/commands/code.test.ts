import { describe, expect, it } from "vitest";
import { paragraph, toggleCodeBlocks, type SmartDocument } from "../index.js";

describe("toggleCodeBlocks", () => {
  it("converts only the selected paragraph beside an existing code block", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [paragraph("first"), paragraph("second"), { type: "codeBlock", text: "third" }],
    };

    const result = toggleCodeBlocks(
      document,
      { type: "text", anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 6 } },
      { parentPath: [], blockIndexes: [1] }
    );

    expect(result.document.children).toEqual([
      paragraph("first"),
      { type: "codeBlock", text: "second" },
      { type: "codeBlock", text: "third" },
    ]);
    expect(result.transaction.selectionAfter).toEqual({ type: "node", path: [1] });
  });

  it("converts only the selected code block back to a paragraph", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{ type: "codeBlock", text: "first" }, { type: "codeBlock", text: "second" }],
    };

    const result = toggleCodeBlocks(
      document,
      { type: "text", anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 6 } },
      { parentPath: [], blockIndexes: [1] }
    );

    expect(result.document.children).toEqual([
      { type: "codeBlock", text: "first" },
      paragraph("second"),
    ]);
  });
});
