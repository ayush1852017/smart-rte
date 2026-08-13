import { describe, expect, it } from "vitest";
import { normalizeTableCell, paragraph } from "./legacy/index.js";

describe("normalizeTableCell", () => {
  it("normalizes br-separated imported cell lines into paragraph blocks", () => {
    const cell = normalizeTableCell(
      { type: "tableCell", children: [] },
      ["one", "two", "three"]
    );

    expect(cell.children).toEqual([
      paragraph("one"),
      paragraph("two"),
      paragraph("three"),
    ]);
  });
});
