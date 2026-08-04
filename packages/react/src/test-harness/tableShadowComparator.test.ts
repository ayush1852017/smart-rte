// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DomTableCommand } from "../adapters/domTableCommandBridge.js";
import { compareRetainedAndCanonicalTable, tableShadowLogRecord } from "./tableShadowComparator.js";

const flat = (rows: number, columns: number) => `<table><tbody>${Array.from({ length: rows }, (_, row) => `<tr>${Array.from({ length: columns }, (_, column) => `<td><p>v${row}-${column}</p></td>`).join("")}</tr>`).join("")}</tbody></table>`;
const merged = `<table><tbody><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></tbody></table>`;

describe("Phase 6 retained table shadow corpus", () => {
  it("reports no unexplained semantic/data-loss result in 2,100 scenarios (seed 0x7AB1E006)", () => {
    let seed = 0x7AB1E006;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const classifications: Record<string, number> = {};
    const byCommand: Record<string, Record<string, number>> = {};
    for (let scenario = 0; scenario < 300; scenario += 1) {
      const rows = 2 + random(4); const columns = 2 + random(4); const html = flat(rows, columns);
      const commands: DomTableCommand[] = [
        { id: "table.row.add", input: { index: random(rows + 1) } },
        { id: "table.row.remove", input: { index: random(rows) } },
        { id: "table.column.add", input: { index: random(columns + 1) } },
        { id: "table.column.remove", input: { index: random(columns) } },
        { id: "table.cell.merge", input: { start: { row: 0, column: 0 }, end: { row: 1, column: 1 } } },
        { id: "table.header.row.toggle", input: { row: 0, column: 0 } },
        { id: "table.cell.split", input: { row: 1, column: 0 } },
      ];
      commands.forEach((command, index) => {
        const result = compareRetainedAndCanonicalTable(command.id === "table.cell.split" ? merged : html, command);
        const classification = result.classification || "equivalent";
        classifications[classification] = (classifications[classification] || 0) + 1;
        byCommand[command.id] ||= {};
        byCommand[command.id][classification] = (byCommand[command.id][classification] || 0) + 1;
        expect(["semantic", "data-loss", "unknown"]).not.toContain(classification);
        expect(JSON.stringify(tableShadowLogRecord(`${scenario}-${index}`, result))).not.toContain("v0-0");
      });
    }
    console.info("Phase 6 shadow classifications", classifications, byCommand);
    expect(Object.values(classifications).reduce((sum, count) => sum + count, 0)).toBe(2_100);
  });
});
