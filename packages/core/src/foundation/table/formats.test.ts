// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema, validate } from "../schema.js";
import { FoundationSubtreeRenderer } from "../surface/renderer.js";
import type { SmartDocument, SmartElementNode } from "../types.js";
import {
  canonicalTablesToDocx, parseCanonicalTableHtml, serializeCanonicalTableHtml,
  cellSelectionFromIds, serializeCanonicalTableMarkdown, snapTableCellRect,
} from "./index.js";

const documentFixture = (): SmartDocument => ({ type: "doc", id: "doc", children: [{
  type: "table", id: "table", attrs: { caption: "Quarterly results", columnWidths: [80, 140], layout: "fixed" }, children: [
    { type: "table_row", id: "r0", children: [
      { type: "table_cell", id: "h", attrs: { header: true, rowspan: 2, colspan: 1 }, children: [{ type: "paragraph", id: "hp", children: [{ type: "text", text: "Region" }] }] },
      { type: "table_cell", id: "a", attrs: { header: true }, children: [{ type: "paragraph", id: "ap", children: [{ type: "text", text: "Sales" }] }] },
    ] },
    { type: "table_row", id: "r1", children: [
      { type: "table_cell", id: "b", children: [{ type: "paragraph", id: "bp", children: [{ type: "text", text: "42" }] }] },
    ] },
  ],
} as SmartElementNode] });

describe("canonical table formats and selection", () => {
  it("round-trips HTML with spans, widths, headers, caption and content", () => {
    const html = serializeCanonicalTableHtml(documentFixture());
    const parsed = parseCanonicalTableHtml(html);
    expect(validate(parsed)).toEqual([]);
    expect(html).toContain("<caption>Quarterly results</caption>");
    expect(html).toContain("rowspan=\"2\"");
    expect(JSON.stringify(parsed)).toContain("Sales");
  });

  it("declares the Markdown fallback lossy while conserving anchor text and exposes DOCX span data", () => {
    const markdown = serializeCanonicalTableMarkdown(documentFixture());
    expect(markdown).toContain("Region");
    expect(markdown).toContain("42");
    const docx = canonicalTablesToDocx(documentFixture())[0];
    expect(docx.columnWidths).toEqual([80, 140]);
    expect(docx.cells.some((cell) => cell.verticalMerge === "continue")).toBe(true);
  });

  it("snaps a partial cell selection to the whole merged span", () => {
    const table = documentFixture().children[0] as SmartElementNode;
    expect(snapTableCellRect(table, { top: 1, left: 0, bottom: 2, right: 1 })).toMatchObject({
      rect: { top: 0, left: 0, bottom: 2, right: 1 }, cellIds: ["h"],
    });
    const positions = createScopeIndex().positions(documentFixture(), foundationSchema);
    expect(positions.exists("h")).toBe(true);
    expect(cellSelectionFromIds("h", "b", positions)).toMatchObject({ type: "cell" });
  });

  it("renders semantic table elements and stable header associations", () => {
    const root = window.document.createElement("div");
    new FoundationSubtreeRenderer(root).render(documentFixture(), { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } });
    expect(root.querySelector("table caption")?.textContent).toBe("Quarterly results");
    expect(root.querySelectorAll("th")).toHaveLength(2);
    expect(root.querySelector("th")?.getAttribute("scope")).toMatch(/row|col/);
    expect(root.querySelector("td")?.getAttribute("headers")).toBeTruthy();
  });

  it("repairs a Word-like mid-table header row into a leading region without losing or downgrading it", () => {
    const parsed = parseCanonicalTableHtml('<table><tr><td>Body A</td><td>Body B</td></tr><tr><th>Mid A</th><th>Mid B</th></tr><tr><td>Tail A</td><td>Tail B</td></tr></table>');
    expect(validate(parsed)).toEqual([]);
    const table = parsed.children[0] as SmartElementNode;
    const rows = table.children as SmartElementNode[];
    expect((rows[1].children as SmartElementNode[]).every((cell) => cell.attrs?.header === true)).toBe(true);
    expect((rows[0].children as SmartElementNode[]).every((cell) => cell.attrs?.header === true)).toBe(true);
    expect(JSON.stringify(parsed)).toContain("Tail B");
  });
});
