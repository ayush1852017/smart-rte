import { describe, expect, it } from "vitest";
import { paragraph, setTextAlignment, type LegacySmartDocument, type LegacySmartSelection } from "../legacy/index.js";

const selection: LegacySmartSelection = {
  type: "text",
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [1, 0], offset: 3 },
};

describe("setTextAlignment", () => {
  it("aligns every requested block in one history transaction", () => {
    const document: LegacySmartDocument = { type: "doc", children: [paragraph("one"), paragraph("two")] };
    const result = setTextAlignment(document, selection, { paths: [[0], [1]], alignment: "center" });

    expect(result.document.children).toEqual([
      { ...paragraph("one"), alignment: "center" },
      { ...paragraph("two"), alignment: "center" },
    ]);
    expect(result.transaction.operations).toHaveLength(2);
    expect(result.transaction.selectionAfter).toEqual(selection);
    expect(result.transaction.addToHistory).toBe(true);
  });

  it("stores left alignment as the document default", () => {
    const document: LegacySmartDocument = {
      type: "doc",
      children: [{ ...paragraph("one"), alignment: "right" }],
    };
    const result = setTextAlignment(document, selection, { paths: [[0]], alignment: "left" });
    expect(result.document.children[0]).toEqual(paragraph("one"));
  });
});
