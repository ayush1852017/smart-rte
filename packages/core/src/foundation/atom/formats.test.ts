// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { atomFromHtmlElement, atomToDocx, atomToHtml, atomToMarkdown, atomToPdf } from "./formats.js";

const parse = (html: string) => {
  const template = document.createElement("template"); template.innerHTML = html; return template.content.firstElementChild!;
};

describe("Phase 7 atom formats", () => {
  it("round-trips images and formula source through full HTML without inline SVG or HTML evaluation", () => {
    const image = { type: "image", id: "i", attrs: { src: "https://x.test/i.png", alt: "A&B", status: "ready", width: 20 } };
    expect(atomFromHtmlElement(parse(atomToHtml(image)))).toEqual(image);
    const formula = { type: "formula", id: "f", attrs: { source: "<img src=x onerror=alert(1)>", notation: "latex" } };
    const html = atomToHtml(formula);
    expect(html).not.toContain("<img src=x");
    expect(parse(html).querySelector("img,script,svg")).toBeNull();
    expect(atomFromHtmlElement(parse(html))).toEqual(formula);
  });

  it("preserves an explicit decorative image choice in full HTML", () => {
    const decorative = { type: "image", id: "decorative", attrs: { src: "images/rule.png", alt: "", decorative: true, status: "ready" } };
    const html = atomToHtml(decorative);
    expect(html).toContain('data-smart-decorative="true"');
    expect(atomFromHtmlElement(parse(html))).toEqual(decorative);
  });

  it("declares Markdown media unsupported but preserves source text", () => {
    const media = { type: "video", id: "v", attrs: { src: "https://x.test/v.mp4", status: "ready" } };
    expect(atomToMarkdown(media)).toContain("https://x.test/v.mp4");
    expect(atomToDocx(media)).toEqual({ kind: "text", source: "[video: https://x.test/v.mp4]" });
    expect(atomToPdf(media).value).toContain("v.mp4");
  });

  it("declares PDF export visual-only for images, matching the declared lossy fidelity", () => {
    const image = { type: "image", id: "i", attrs: { src: "https://x.test/i.png", alt: "A picture", status: "ready" } };
    expect(atomToPdf(image)).toEqual({ kind: "image", value: "https://x.test/i.png" });
  });

  it("describes DOCX formulas as literal LaTeX text, matching the actual exporter (not a rendered image)", () => {
    expect(atomToDocx({ type: "formula", id: "f", attrs: { source: "x^2", notation: "latex" } })).toEqual({ kind: "text", source: "x^2" });
  });
});
