// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildPdfPrintDocument, printSmartDocumentAsPdf } from "./pdfFormat.js";

const model = {
  type: "doc" as const,
  children: [
    { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text: "Report" }] },
    { type: "paragraph" as const, children: [{ type: "formula" as const, value: "x^2" }] },
  ],
};

describe("PDF format adapter", () => {
  it("builds a standalone print document from canonical content", () => {
    const html = buildPdfPrintDocument(model);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h2>Report</h2>");
    expect(html).toContain('data-formula="x^2"');
    expect(html).toContain("@page { margin: 18mm; }");
  });

  it("keeps window side effects behind an explicit print function", () => {
    const addEventListener = vi.fn();
    const popup = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      addEventListener,
      setTimeout: vi.fn(),
      focus: vi.fn(),
      print: vi.fn(),
    };
    const host = { open: vi.fn(() => popup) } as unknown as Window;
    expect(printSmartDocumentAsPdf(model, host)).toBe(true);
    expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("<h2>Report</h2>"));
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
  });

  it("reports a blocked popup without throwing", () => {
    const host = { open: vi.fn(() => null) } as unknown as Window;
    expect(printSmartDocumentAsPdf(model, host)).toBe(false);
  });
});
