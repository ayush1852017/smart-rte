import { describe, expect, it } from "vitest";
import { createEditorFormatRuntime } from "./formatRuntime.js";

describe("editor format runtime", () => {
  it("enables standard formats by default", () => {
    const runtime = createEditorFormatRuntime();
    expect(runtime.formats.map((format) => format.id)).toEqual(["pdf", "docx", "html", "markdown"]);
    expect(runtime.canImport("docx")).toBe(true);
    expect(runtime.canExport("pdf")).toBe(true);
    expect(runtime.get("html")?.importFile).toEqual(expect.any(Function));
    expect(runtime.get("pdf")?.exportDocument).toEqual(expect.any(Function));
  });

  it("independently disables formats across import and export", () => {
    const runtime = createEditorFormatRuntime({ pdf: false, markdown: false });
    expect(runtime.has("pdf")).toBe(false);
    expect(runtime.canImport("markdown")).toBe(false);
    expect(runtime.imports.map((format) => format.id)).toEqual(["docx", "html"]);
    expect(runtime.exports.map((format) => format.id)).toEqual(["docx", "html"]);
  });

  it("accepts replacement definitions and rejects duplicate ids", () => {
    const htmlOnly = [{ id: "html" as const, label: "Custom HTML", extension: "xhtml", canImport: false, canExport: true }];
    const runtime = createEditorFormatRuntime({}, htmlOnly);
    expect(runtime.canImport("html")).toBe(false);
    expect(runtime.canExport("html")).toBe(true);
    expect(runtime.formats[0].label).toBe("Custom HTML");
    expect(() => createEditorFormatRuntime({}, [...htmlOnly, ...htmlOnly])).toThrow(/Duplicate editor format/);
  });
});
