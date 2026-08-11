// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { exportDocxDocument, importDocxDocumentWithMammoth } from "./docxFormat.js";
import { buildPdfPrintDocument, printSmartDocumentAsPdf } from "./pdfFormat.js";
import { smartDocumentFromHtml } from "./domSmartDocument.js";

const readBlob = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(blob);
});

/**
 * This guard deliberately calls the format adapters directly. It does not
 * mount ClassicEditor and does not import any ROLLBACK_ADAPTER bridge. The
 * export path therefore remains protected when the four rollback bridges are
 * removed after Phase 8b promotion.
 */
describe("Phase 8b format export guard", () => {
  const source = {
    type: "doc" as const,
    children: [
      { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text: "Export guard" }] },
      { type: "paragraph" as const, children: [{ type: "text" as const, text: "DOCX and PDF must retain this text." }] },
    ],
  };

  it("DOCX export can be imported without a rollback bridge", async () => {
    const buffer = await readBlob(await exportDocxDocument(source));
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("word/document.xml")).toBeTruthy();
    const imported = await importDocxDocumentWithMammoth(buffer, document);
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
    expect(emitted).toContain("<h2>Export guard</h2>");
    const body = emitted.match(/<body>([\s\S]*)<\/body>/)?.[1] || "";
    const roundTripped = smartDocumentFromHtml(body, document);
    expect(roundTripped.children.map((node) => node.type)).toEqual(["heading", "paragraph"]);
    expect(roundTripped.children.map((node) => (node as { children?: Array<{ type: string; text?: string }> }).children?.map((child) => child.type === "text" ? child.text : "").join(""))).toEqual([
      "Export guard", "DOCX and PDF must retain this text.",
    ]);
  });
});
