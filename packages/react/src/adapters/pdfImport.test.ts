// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reconstructPdfPages, type PdfPageSnapshot } from "./pdfFormat.js";

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
    const result = reconstructPdfPages([page], document);
    expect(result.pages).toBe(1);
    expect(result.document.children.map((block) => block.type)).toEqual(["heading", "list", "paragraph"]);
    expect(result.document.children[0]).toMatchObject({ type: "heading", alignment: "center" });
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
    const result = reconstructPdfPages([page], document);
    expect(result.document.children[0].type).toBe("table");
    expect(result.layoutHtml).toContain("<td");
  });

  it("escapes extracted PDF text", () => {
    const result = reconstructPdfPages([{ width: 600, items: [item("<script>", 40, 700)] }], document);
    expect(result.layoutHtml).toContain("&lt;script&gt;");
    expect(result.layoutHtml).not.toContain("<script>");
  });
});
