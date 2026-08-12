import { describe, expect, it, vi } from "vitest";
import type { SmartDocument } from "smartrte-core/foundation";
import { printSmartDocumentAsPdf } from "./pdfPrint.js";

const model: SmartDocument = {
  type: "doc", id: "doc",
  children: [{ type: "heading", id: "h1", attrs: { level: 2 }, children: [{ type: "text", text: "Report" }] }],
};

describe("PDF print window", () => {
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
    expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("Report</h2>"));
    expect(addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
  });

  it("reports a blocked popup without throwing", () => {
    const host = { open: vi.fn(() => null) } as unknown as Window;
    expect(printSmartDocumentAsPdf(model, host)).toBe(false);
  });
});
