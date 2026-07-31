import { describe, expect, it } from "vitest";
import {
  builtInFormatFidelity,
  getFormatFidelity,
  type FidelityFeature,
  type FidelityFormat,
} from "./formatFidelity.js";

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
  });
});
