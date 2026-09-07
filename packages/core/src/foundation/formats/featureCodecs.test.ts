// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { builtInFeatureFormatCodecs } from "./featureCodecs.js";
import { builtInFormatFidelity } from "./fidelity.js";

describe("Phase 9 SS3 gate 3: FeatureFormatCodec declarations", () => {
  it("declares exactly one codec per (feature, format) pair, matching the fidelity table 1:1", () => {
    const expectedCount = builtInFormatFidelity.length * 4;
    expect(builtInFeatureFormatCodecs).toHaveLength(expectedCount);
    for (const contract of builtInFormatFidelity) {
      for (const format of ["html", "markdown", "docx", "pdf"] as const) {
        const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === contract.feature && entry.format === format);
        expect(codec, `missing codec for ${contract.feature}/${format}`).toBeDefined();
        expect(codec!.fidelity).toBe(contract.formats[format].level);
        expect(codec!.note).toBe(contract.formats[format].note);
      }
    }
  });

  it("attaches a real serialize function to images-media, formulas, and page-break, the only features with a genuine single-node implementation", () => {
    for (const feature of ["images-media", "formulas", "page-break"] as const) {
      for (const format of ["html", "markdown", "docx", "pdf"] as const) {
        const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === feature && entry.format === format)!;
        expect(codec.serialize, `${feature}/${format} should have a real serialize function`).toBeTypeOf("function");
      }
    }
  });

  /**
   * Phase 11 Tier 2 wired real DOCX-only serialize for marks
   * (inline-marks/colors-fonts-sizes) and block (headings-alignment/
   * blockquote-code) - docxProperties and blockToDocxEntry were already
   * genuine single-node functions (the latter extracted from
   * canonicalBlocksToDocx's per-node visit() body). No reverse (parse)
   * mapping exists for either, and HTML/Markdown/PDF for these features
   * remain whole-document walkers per docs/PHASE_9_CODEC_REFACTOR_SCOPE.md's
   * scope (HTML/Markdown scheduled last "if at all").
   */
  it("attaches a real docx-only serialize function to the two Phase 11 Tier 2 codec-slice feature families, and later line-height (same blockToDocxEntry projection)", () => {
    for (const feature of ["inline-marks", "colors-fonts-sizes", "headings-alignment", "blockquote-code", "line-height"] as const) {
      const docx = builtInFeatureFormatCodecs.find((entry) => entry.feature === feature && entry.format === "docx")!;
      expect(docx.serialize, `${feature}/docx should have a real serialize function`).toBeTypeOf("function");
      expect(docx.parse, `${feature}/docx has no reverse mapping`).toBeUndefined();
      for (const format of ["html", "markdown", "pdf"] as const) {
        const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === feature && entry.format === format)!;
        expect(codec.serialize, `${feature}/${format} should remain whole-document-only`).toBeUndefined();
      }
    }
  });

  it("leaves parse/serialize undefined for the 35 remaining cells backed only by whole-document walkers", () => {
    const wired = new Set(["inline-marks/docx", "colors-fonts-sizes/docx", "headings-alignment/docx", "blockquote-code/docx", "line-height/docx"]);
    const withoutRealCodec = builtInFeatureFormatCodecs.filter((entry) =>
      entry.feature !== "images-media" && entry.feature !== "formulas" && entry.feature !== "page-break" && !wired.has(`${entry.feature}/${entry.format}`));
    // 13 features total; images-media/formulas/page-break (3) get every
    // format wired via atom/formats.ts's per-node functions, leaving 10
    // features here - 5 of which (the `wired` set above) have their own
    // single docx cell wired via blockToDocxEntry/docxProperties.
    expect(withoutRealCodec).toHaveLength(10 * 4 - wired.size);
    for (const codec of withoutRealCodec) {
      expect(codec.serialize).toBeUndefined();
      expect(codec.parse).toBeUndefined();
    }
  });

  it("serializes real mark and block nodes to DOCX projections via the declared codecs, matching docxProperties/blockToDocxEntry directly", () => {
    const bold = { type: "text", text: "hi", marks: [{ type: "bold" }] } as never;
    const marksDocx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "inline-marks" && entry.format === "docx")!;
    expect(marksDocx.serialize!(bold, { format: "docx" })).toEqual({ bold: true });

    const colorText = { type: "text", text: "hi", marks: [{ type: "textColor", attrs: { value: "#ff0000" } }] } as never;
    const colorsDocx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "colors-fonts-sizes" && entry.format === "docx")!;
    expect(colorsDocx.serialize!(colorText, { format: "docx" })).toEqual({ color: "#ff0000" });

    const heading = { type: "heading", id: "h1", attrs: { level: 2 }, children: [{ type: "text", text: "Title" }] } as never;
    const headingsDocx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "headings-alignment" && entry.format === "docx")!;
    expect(headingsDocx.serialize!(heading, { format: "docx" })).toEqual({ nodeId: "h1", kind: "heading", text: "Title", style: "Heading2", outlineLevel: 1 });

    const codeBlock = { type: "code_block", id: "c1", attrs: { language: "js" }, children: [{ type: "text", text: "x" }] } as never;
    const blockquoteDocx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "blockquote-code" && entry.format === "docx")!;
    expect(blockquoteDocx.serialize!(codeBlock, { format: "docx" })).toEqual({ nodeId: "c1", kind: "code", text: "x", style: "Code", language: "js" });

    const spaced = { type: "paragraph", id: "p1", attrs: { lineHeight: 1.5 }, children: [{ type: "text", text: "Spaced" }] } as never;
    const lineHeightDocx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "line-height" && entry.format === "docx")!;
    expect(lineHeightDocx.serialize!(spaced, { format: "docx" })).toEqual({ nodeId: "p1", kind: "paragraph", text: "Spaced", style: "Normal", lineSpacing240ths: 360 });
  });

  it("serializes a real formula atom to HTML, Markdown, DOCX, and PDF projections via the declared codecs", () => {
    const formula = { type: "formula", id: "f1", attrs: { source: "x^2", notation: "latex" } } as never;
    const html = builtInFeatureFormatCodecs.find((entry) => entry.feature === "formulas" && entry.format === "html")!;
    expect(html.serialize!(formula, { format: "html" })).toContain('data-smart-formula="x^2"');

    const markdown = builtInFeatureFormatCodecs.find((entry) => entry.feature === "formulas" && entry.format === "markdown")!;
    expect(markdown.serialize!(formula, { format: "markdown" })).toBe("$x^2$");

    const docx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "formulas" && entry.format === "docx")!;
    expect(docx.serialize!(formula, { format: "docx" })).toEqual({ kind: "text", source: "x^2" });

    const pdf = builtInFeatureFormatCodecs.find((entry) => entry.feature === "formulas" && entry.format === "pdf")!;
    expect(pdf.serialize!(formula, { format: "pdf" })).toEqual({ kind: "text", value: "x^2" });
  });

  it("serializes a real page break atom to HTML, Markdown, DOCX, and PDF projections via the declared codecs", () => {
    const pageBreak = { type: "page_break", id: "pb1" } as never;
    const html = builtInFeatureFormatCodecs.find((entry) => entry.feature === "page-break" && entry.format === "html")!;
    expect(html.serialize!(pageBreak, { format: "html" })).toContain("break-before: page");

    const markdown = builtInFeatureFormatCodecs.find((entry) => entry.feature === "page-break" && entry.format === "markdown")!;
    expect(markdown.serialize!(pageBreak, { format: "markdown" })).toBe("<!-- page break -->");

    const docx = builtInFeatureFormatCodecs.find((entry) => entry.feature === "page-break" && entry.format === "docx")!;
    expect(docx.serialize!(pageBreak, { format: "docx" })).toEqual({ kind: "pageBreak", source: "" });

    const pdf = builtInFeatureFormatCodecs.find((entry) => entry.feature === "page-break" && entry.format === "pdf")!;
    expect(pdf.serialize!(pageBreak, { format: "pdf" })).toEqual({ kind: "pageBreak", value: "" });
  });

  it("parses a real HTML image element back to a canonical node via the declared codec", () => {
    const root = document.createElement("div");
    root.innerHTML = '<img data-smart-id="img1" data-smart-type="image" src="https://example.com/a.png" alt="diagram">';
    const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === "images-media" && entry.format === "html")!;
    const parsed = codec.parse!(root.firstElementChild, { format: "html" });
    expect(parsed).toMatchObject({ type: "image", attrs: { src: "https://example.com/a.png", alt: "diagram" } });
  });
});
