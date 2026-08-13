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

  it("attaches a real serialize function to images-media and formulas, the only features with a genuine single-node implementation", () => {
    for (const feature of ["images-media", "formulas"] as const) {
      for (const format of ["html", "markdown", "docx", "pdf"] as const) {
        const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === feature && entry.format === format)!;
        expect(codec.serialize, `${feature}/${format} should have a real serialize function`).toBeTypeOf("function");
      }
    }
  });

  it("leaves parse/serialize undefined for the 36 cells backed only by whole-document walkers", () => {
    const withoutRealCodec = builtInFeatureFormatCodecs.filter((entry) => entry.feature !== "images-media" && entry.feature !== "formulas");
    expect(withoutRealCodec).toHaveLength(9 * 4);
    for (const codec of withoutRealCodec) {
      expect(codec.serialize).toBeUndefined();
      expect(codec.parse).toBeUndefined();
    }
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

  it("parses a real HTML image element back to a canonical node via the declared codec", () => {
    const root = document.createElement("div");
    root.innerHTML = '<img data-smart-id="img1" data-smart-type="image" src="https://example.com/a.png" alt="diagram">';
    const codec = builtInFeatureFormatCodecs.find((entry) => entry.feature === "images-media" && entry.format === "html")!;
    const parsed = codec.parse!(root.firstElementChild, { format: "html" });
    expect(parsed).toMatchObject({ type: "image", attrs: { src: "https://example.com/a.png", alt: "diagram" } });
  });
});
