// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createDocumentFormatRegistry,
  DocumentFormatRegistry,
  exportTextDocument,
  getDocumentFormatAdapter,
  importTextDocument,
  roundTripTextDocument,
} from "./documentFormats.js";
import { normalizeSmartDocument, type LegacySmartDocument } from "smartrte-core/legacy";

describe("document format adapters", () => {
  it("exposes stable format metadata", () => {
    expect(getDocumentFormatAdapter("html")).toMatchObject({
      id: "html",
      extension: "html",
      mediaType: "text/html;charset=utf-8",
    });
    expect(getDocumentFormatAdapter("markdown")).toMatchObject({
      id: "markdown",
      extension: "md",
      mediaType: "text/markdown;charset=utf-8",
    });
  });

  it("supports independently registered adapters and rejects duplicate ids", () => {
    const custom = {
      id: "html" as const,
      extension: "custom",
      mediaType: "text/custom",
      importDocument: () => ({ type: "doc" as const, children: [] }),
      exportDocument: () => "custom",
    };
    const registry = new DocumentFormatRegistry([custom]);
    expect(registry.has("html")).toBe(true);
    expect(registry.get("html").extension).toBe("custom");
    expect(() => registry.register(custom)).toThrow(/Duplicate document format adapter/);
    expect(createDocumentFormatRegistry().list().map((adapter) => adapter.id)).toEqual(["html", "markdown"]);
  });

  it("round-trips supported HTML semantics through the canonical model", () => {
    const model = importTextDocument(
      "html",
      '<h2 style="text-align:center;margin-left:48px"><strong>Title</strong></h2><ol style="list-style-type:lower-alpha"><li>One</li><li>Two</li></ol>',
      { ownerDocument: document },
    );
    expect(model.children[0]).toMatchObject({ type: "heading", level: 2, alignment: "center", indent: 2 });
    expect(model.children[1]).toMatchObject({ type: "list", style: "lower-alpha" });
    expect(exportTextDocument("html", model)).toContain('style="text-align:center;margin-left:48px"');
    expect(exportTextDocument("html", model)).toContain("list-style-type:lower-alpha");
  });

  it("round-trips list preset identity with a portable marker fallback", () => {
    const model = importTextDocument(
      "html",
      '<ol data-srte-list-preset="ordered-decimal-paren" style="list-style-type:decimal"><li>One</li></ol>',
      { ownerDocument: document },
    );
    expect(model.children[0]).toMatchObject({
      type: "list",
      style: "decimal",
      preset: "ordered-decimal-paren",
    });
    const exported = exportTextDocument("html", model);
    expect(exported).toContain('data-srte-list-preset="ordered-decimal-paren"');
    expect(exported).toContain("list-style-type:decimal");
  });

  it("round-trips Markdown lists, marks, formulas, and inline images", () => {
    const markdown = [
      "## **Title**",
      "",
      "1. One",
      "2. Two",
      "",
      "Formula $x^2$ and ![diagram](https://example.com/a.png)",
    ].join("\n");
    const model = importTextDocument("markdown", markdown, { ownerDocument: document });
    const exported = exportTextDocument("markdown", model);
    expect(exported).toContain("## **Title**");
    expect(exported).toContain("1. One");
    expect(exported).toContain("$x^2$");
    expect(exported).toContain("![diagram](https://example.com/a.png)");
  });

  it("round-trips the canonical HTML table and checklist contract", () => {
    const source: LegacySmartDocument = {
      type: "doc",
      children: [
        {
          type: "list",
          style: "disc",
          checklist: true,
          children: [
            { type: "listItem", checked: true, children: [{ type: "paragraph", children: [{ type: "text", text: "Done" }] }] },
            { type: "listItem", checked: false, children: [{ type: "paragraph", children: [{ type: "text", text: "Pending" }] }] },
          ],
        },
        {
          type: "table",
          columnWidths: [90, 180],
          children: [{
            type: "tableRow",
            heightPx: 48,
            children: [
              {
                type: "tableHeaderCell",
                backgroundColor: "rgb(18, 52, 86)",
                textColor: "rgb(255, 255, 255)",
                border: "none",
                children: [{ type: "paragraph", children: [{ type: "text", text: "Header" }] }],
              },
              {
                type: "tableCell",
                children: [{ type: "paragraph", children: [
                  { type: "text", text: "Value " },
                  { type: "formula", value: "x^2" },
                ] }],
              },
            ],
          }],
        },
      ],
    };
    expect(roundTripTextDocument("html", source, { ownerDocument: document }))
      .toEqual(normalizeSmartDocument(source));
  });

  it("round-trips GFM checklist state through the shared harness", () => {
    const source = importTextDocument("markdown", "- [x] Done\n- [ ] Pending", {
      ownerDocument: document,
    });
    const roundTripped = roundTripTextDocument("markdown", source, { ownerDocument: document });
    expect(roundTripped.children[0]).toMatchObject({
      type: "list",
      checklist: true,
      children: [{ checked: true }, { checked: false }],
    });
  });
});
