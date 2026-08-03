import { describe, expect, it } from "vitest";
import { paragraph, toggleTableCellList, type LegacySmartDocument, type SmartTableNode } from "../index.js";

describe("toggleTableCellList", () => {
  it("changes only selected blocks in one table cell", () => {
    const table: SmartTableNode = {
      type: "table",
      children: [{
        type: "tableRow",
        children: [{
          type: "tableCell",
          children: [paragraph("one"), paragraph("two"), paragraph("three")],
        }],
      }],
    };
    const document: LegacySmartDocument = { type: "doc", children: [table] };

    const result = toggleTableCellList(
      document,
      { type: "text", anchor: { path: [0, 0, 0, 1], offset: 0 }, focus: { path: [0, 0, 0, 2], offset: 5 } },
      { tablePath: [0], row: 0, column: 0, blockIndexes: [1, 2], style: "disc" }
    );

    const cell = (result.document.children[0] as SmartTableNode).children[0].children[0];
    expect(cell.children).toEqual([
      paragraph("one"),
      {
        type: "list",
        style: "disc",
        children: [
          { type: "listItem", children: [paragraph("two")] },
          { type: "listItem", children: [paragraph("three")] },
        ],
      },
    ]);
    expect(result.transaction.addToHistory).toBe(true);
    expect(result.transaction.selectionAfter).toEqual({ type: "node", path: [0, 0, 0, 1] });
  });
});
