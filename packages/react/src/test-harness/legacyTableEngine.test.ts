// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeRetainedLegacyTable } from "./legacyTableEngine.js";

describe("retained pre-Phase-6 legacy table engine", () => {
  it("retains merge, split, and span-aware row/column behavior before deletion", () => {
    const source = "<table><tbody><tr><td rowspan=\"2\"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></tbody></table>";
    const merged = executeRetainedLegacyTable(source, {
      id: "table.cell.merge",
      input: { start: { row: 0, column: 0 }, end: { row: 1, column: 1 } },
    });
    expect(merged).toContain("rowspan=\"2\"");
    expect(merged).toContain("colspan=\"2\"");
    expect(merged).toContain("<p>A</p><p>B</p><p>C</p>");

    const row = executeRetainedLegacyTable(source, { id: "table.row.add", input: { index: 1 } });
    expect(row).toContain("rowspan=\"3\"");

    const column = executeRetainedLegacyTable(source, { id: "table.column.add", input: { index: 1 } });
    expect(column?.match(/<td/g)).toHaveLength(5);
  });

  it("is not imported by product code", () => {
    expect(import.meta.url).toContain("test-harness/legacyTableEngine.test");
  });
});
