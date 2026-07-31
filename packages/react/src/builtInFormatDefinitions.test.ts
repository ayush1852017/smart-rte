// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBuiltInFormatDefinitions } from "./builtInFormatDefinitions.js";

describe("built-in executable format definitions", () => {
  it("provides handlers for every advertised operation", () => {
    const definitions = createBuiltInFormatDefinitions();
    expect(definitions.map((definition) => definition.id)).toEqual([
      "pdf", "docx", "html", "markdown",
    ]);
    definitions.forEach((definition) => {
      if (definition.canImport) expect(definition.importFile).toEqual(expect.any(Function));
      if (definition.canExport) expect(definition.exportDocument).toEqual(expect.any(Function));
    });
    expect(definitions.find((definition) => definition.id === "pdf")?.confirmImportWhenNotEmpty).toBe(true);
    expect(definitions.find((definition) => definition.id === "docx")?.confirmImportWhenNotEmpty).toBe(true);
  });

  it("imports and exports HTML through the canonical document model", async () => {
    const html = createBuiltInFormatDefinitions().find((definition) => definition.id === "html")!;
    const imported = await html.importFile!(
      { text: async () => "<h2>Hello</h2><p><strong>world</strong></p>" } as File,
      { ownerDocument: document },
    );
    expect(imported.document.children[0]).toMatchObject({ type: "heading", level: 2 });

    const exported = await html.exportDocument!(imported.document, {
      ownerDocument: document,
      hostWindow: window,
    });
    expect(exported.kind).toBe("text");
    if (exported.kind === "text") {
      expect(exported.filename).toBe("smart-rte-export.html");
      expect(exported.content).toContain("<!doctype html>");
      expect(exported.content).toContain("<h2>Hello</h2>");
    }
  });

  it("imports and exports Markdown through the canonical document model", async () => {
    const markdown = createBuiltInFormatDefinitions().find((definition) => definition.id === "markdown")!;
    const imported = await markdown.importFile!(
      { text: async () => "## Hello\n\n- one\n- two" } as File,
      { ownerDocument: document },
    );
    expect(imported.document.children[0]).toMatchObject({ type: "heading", level: 2 });

    const exported = await markdown.exportDocument!(imported.document, {
      ownerDocument: document,
      hostWindow: window,
    });
    expect(exported).toMatchObject({
      kind: "text",
      filename: "smart-rte-export.md",
    });
  });
});
