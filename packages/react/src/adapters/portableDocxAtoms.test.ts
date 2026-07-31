// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  portableFormulaMarker,
  portableImageMarker,
  restorePortableDocxAtoms,
} from "./portableDocxAtoms.js";

describe("portable DOCX atoms", () => {
  it("round-trips formula and image fallback runs", () => {
    const formula = portableFormulaMarker("\\frac{α}{β}", "α/β");
    const image = portableImageMarker("https://example.test/a.png", "Diagram", "Title");
    const html = restorePortableDocxAtoms(`<p>Before ${formula} ${image} after</p>`, document);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector("[data-formula]")?.getAttribute("data-formula")).toBe("\\frac{α}{β}");
    expect(root.querySelector("[data-formula]")?.textContent).toBe("α/β");
    expect(root.querySelector("img")?.src).toBe("https://example.test/a.png");
    expect(root.querySelector("img")?.alt).toBe("Diagram");
    expect(root.textContent).toContain("Before");
    expect(root.textContent).toContain("after");
  });

  it("leaves malformed or ordinary text untouched", () => {
    const html = "<p>Currency $20 and ⟦SRTE_FORMULA:not-json⟧</p>";
    expect(restorePortableDocxAtoms(html, document)).toBe(html);
  });
});
