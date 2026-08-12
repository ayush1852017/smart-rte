import { describe, expect, it } from "vitest";
import type { SmartDocument } from "../../types.js";
import { buildPdfPrintDocument, reconstructPdfPages, type PdfPageSnapshot } from "./format.js";

const model: SmartDocument = {
  type: "doc", id: "doc",
  children: [
    { type: "heading", id: "h1", attrs: { level: 2 }, children: [{ type: "text", text: "Report" }] },
    { type: "paragraph", id: "p1", children: [{ type: "formula", id: "f1", attrs: { source: "x^2", notation: "latex" } }] },
  ],
};

describe("canonical PDF format codec", () => {
  it("builds a standalone print document from canonical content", () => {
    const html = buildPdfPrintDocument(model);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h2");
    expect(html).toContain("Report</h2>");
    expect(html).toContain('data-smart-formula="x^2"');
    expect(html).toContain("@page { margin: 18mm; }");
  });
});

const item = (text: string, x: number, y: number, height = 12, width = text.length * 6, fontFamily = "Arial") =>
  ({ text, x, y, height, width, fontFamily });

describe("PDF reconstruction", () => {
  it("reconstructs headings, lists, alignment, and paragraphs into the model", () => {
    const page: PdfPageSnapshot = {
      width: 600,
      items: [
        item("Report", 270, 700, 24, 60, "Arial Bold"),
        item("• First", 40, 650),
        item("• Second", 40, 630),
        item("Body", 50, 590),
      ],
    };
    const result = reconstructPdfPages([page]);
    expect(result.pages).toBe(1);
    expect(result.document.children.map((block) => (block as { type: string }).type)).toEqual(["heading", "list", "paragraph"]);
    expect(result.layoutHtml).toContain("text-align:center");
    expect(result.layoutHtml).toContain("<ul>");
    expect(result.layoutHtml).not.toContain("• First");
  });

  it("reconstructs aligned columns as a table", () => {
    const page: PdfPageSnapshot = {
      width: 600,
      items: [
        item("Name", 40, 700, 12, 30),
        item("Score", 220, 700, 12, 35),
        item("Ayush", 40, 680, 12, 35),
        item("10", 220, 680, 12, 15),
      ],
    };
    const result = reconstructPdfPages([page]);
    expect((result.document.children[0] as { type: string }).type).toBe("table");
    expect(result.layoutHtml).toContain("<td");
  });

  it("escapes extracted PDF text", () => {
    const result = reconstructPdfPages([{ width: 600, items: [item("<script>", 40, 700)] }]);
    expect(result.layoutHtml).toContain("&lt;script&gt;");
    expect(result.layoutHtml).not.toContain("<script>");
  });
});
