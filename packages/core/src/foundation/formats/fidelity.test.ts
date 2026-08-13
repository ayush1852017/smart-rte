import { describe, expect, it } from "vitest";
import {
  builtInFormatFidelity,
  getFormatFidelity,
  type FidelityFeature,
  type FidelityFormat,
} from "./fidelity.js";

describe("built-in format fidelity contract", () => {
  it("defines every feature against every built-in format", () => {
    const formats: FidelityFormat[] = ["html", "markdown", "docx", "pdf"];
    const features: FidelityFeature[] = [
      "inline-marks",
      "colors-fonts-sizes",
      "headings-alignment",
      "blockquote-code",
      "lists",
      "checklists",
      "tables",
      "links",
      "images-media",
      "formulas",
      "special-characters",
    ];
    expect(builtInFormatFidelity.map(({ feature }) => feature)).toEqual(features);
    builtInFormatFidelity.forEach(({ formats: capabilities }) => {
      expect(Object.keys(capabilities).sort()).toEqual([...formats].sort());
      Object.values(capabilities).forEach((capability) => {
        expect(["full", "semantic", "lossy", "unsupported"]).toContain(capability.level);
        expect(capability.note.length).toBeGreaterThan(0);
      });
    });
  });

  it("keeps HTML canonical and PDF explicitly layout-oriented", () => {
    expect(getFormatFidelity("tables", "html").level).toBe("full");
    expect(getFormatFidelity("formulas", "html").level).toBe("full");
    expect(getFormatFidelity("tables", "pdf").level).toBe("lossy");
    expect(getFormatFidelity("formulas", "pdf").level).toBe("lossy");
    expect(getFormatFidelity("formulas", "docx").level).toBe("lossy");
  });

  it("does not let table Markdown fidelity regress toward a false semantic claim", () => {
    // GFM tables cannot represent merged cells, spans, or block content in
    // cells - this must stay lossy, not semantic. Explicit regression guard
    // per Phase 9 SS2.2 exit gate 5.
    expect(getFormatFidelity("tables", "markdown").level).toBe("lossy");
  });

  it("keeps DOCX formula fidelity honest about what actually happens on export", () => {
    // Phase 9 SS2.1 replaced the legacy-model DOCX exporter; formulas are
    // written as literal LaTeX text inside an <m:oMath> zone; there is no
    // "rendered-image fallback" anymore. This guards against the fidelity
    // note silently drifting stale again the way it did before SS2.2.
    const note = getFormatFidelity("formulas", "docx").note;
    expect(note).not.toContain("rendered-image");
    expect(note).not.toContain("transitional legacy exporter");
  });
});
