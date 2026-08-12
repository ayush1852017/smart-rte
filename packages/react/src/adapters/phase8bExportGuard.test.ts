import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { exportDocxDocument, importDocxDocumentWithMammoth, parseCanonicalListHtml, type SmartDocument } from "smartrte-core/foundation";
import { printSmartDocumentAsPdf } from "./pdfPrint.js";

/**
 * This guard deliberately calls the format codecs directly, without
 * mounting any editor component. Originally written to prove DOCX/PDF
 * export didn't depend on the (now-deleted) rollback bridges; now that
 * canonical is the only implementation, it proves the same thing one
 * level deeper - format export/import has zero framework dependency at
 * all (packages/core, no React, no DOM environment beyond the default
 * jsdom test environment this file normally runs under for Blob/
 * print-window mocking).
 */
describe("Phase 8b format export guard", () => {
  const source: SmartDocument = {
    type: "doc", id: "doc",
    children: [
      { type: "heading", id: "h1", attrs: { level: 2 }, children: [{ type: "text", text: "Export guard" }] },
      { type: "paragraph", id: "p1", children: [{ type: "text", text: "DOCX and PDF must retain this text." }] },
    ],
  };

  it("DOCX export can be imported without any editor mounted", async () => {
    const buffer = await (await exportDocxDocument(source)).arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("word/document.xml")).toBeTruthy();
    const imported = await importDocxDocumentWithMammoth(buffer);
    expect(imported.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "heading" }),
      expect.objectContaining({ type: "paragraph" }),
    ]));
    expect(imported.children.map((node) => (node as { children?: Array<{ type: string; text?: string }> }).children?.map((child) => child.type === "text" ? child.text : "").join("").trim()).join(" ")).toContain("Export guard");
  });

  it("PDF print export round-trips its emitted HTML independently", () => {
    const popup = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      addEventListener: vi.fn(),
      setTimeout: vi.fn(),
      focus: vi.fn(),
      print: vi.fn(),
    };
    const host = { open: vi.fn(() => popup) } as unknown as Window;
    expect(printSmartDocumentAsPdf(source, host)).toBe(true);
    const emitted = String((popup.document.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] || "");
    expect(emitted).toContain("Export guard</h2>");
    const body = emitted.match(/<body>([\s\S]*)<\/body>/)?.[1] || "";
    const roundTripped = parseCanonicalListHtml(body);
    expect(roundTripped.children.map((node) => (node as { type: string }).type)).toEqual(["heading", "paragraph"]);
    expect(roundTripped.children.map((node) => (node as { children?: Array<{ type: string; text?: string }> }).children?.map((child) => child.type === "text" ? child.text : "").join(""))).toEqual([
      "Export guard", "DOCX and PDF must retain this text.",
    ]);
  });
});
