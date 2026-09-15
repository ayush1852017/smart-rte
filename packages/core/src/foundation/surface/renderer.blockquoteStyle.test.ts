// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validate } from "../schema.js";
import type { SmartDocument, SmartSelection } from "../types.js";
import { FoundationSubtreeRenderer } from "./renderer.js";

const noneSelection: SmartSelection = { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };

const quoteDoc = (attrs: Record<string, unknown>): SmartDocument => ({
  type: "doc", id: "doc",
  children: [{ type: "blockquote", id: "quote", attrs, children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "text" }] }] }],
});

describe("blockquote background/text/border colour rendering", () => {
  it("renders backgroundColor, textColor, and borderLeft as real inline CSS", () => {
    const root = window.document.createElement("div");
    const doc = quoteDoc({ backgroundColor: "#fff3bf", textColor: "#1971c2", borderLeft: "4px dashed #e8590c" });
    new FoundationSubtreeRenderer(root).render(doc, noneSelection);
    const quote = root.querySelector("blockquote")!;
    expect(quote.style.background).toBe("rgb(255, 243, 191)");
    expect(quote.style.color).toBe("rgb(25, 113, 194)");
    expect(quote.style.borderLeft).toBe("4px dashed rgb(232, 89, 12)");
    expect(validate(doc)).toEqual([]);
  });

  it("leaves the theme's default styling untouched when the attrs are absent", () => {
    const root = window.document.createElement("div");
    new FoundationSubtreeRenderer(root).render(quoteDoc({}), noneSelection);
    const quote = root.querySelector("blockquote")!;
    expect(quote.style.background).toBe("");
    expect(quote.style.color).toBe("");
    expect(quote.style.borderLeft).toBe("");
  });

  it("clears previously-rendered styling on a diff-update once the attrs are removed", () => {
    const root = window.document.createElement("div");
    const renderer = new FoundationSubtreeRenderer(root);
    renderer.render(quoteDoc({ backgroundColor: "#fff3bf", textColor: "#1971c2", borderLeft: "4px dashed #e8590c" }), noneSelection);
    const quote = root.querySelector("blockquote")!;
    expect(quote.getAttribute("style")).toContain("background");

    // Reads the real `style` attribute rather than the live
    // CSSStyleDeclaration getter - jsdom's `.style.x` getter doesn't
    // reflect a same-tick removeProperty call made through an
    // already-captured element reference, even though the actual DOM
    // attribute is correctly cleared (confirmed via getAttribute above);
    // this is the identical test-environment artifact already documented
    // in docs/bugs/table-cell-text-color-not-rendered.md, not a real
    // rendering difference.
    renderer.render(quoteDoc({}), noneSelection);
    expect(quote.getAttribute("style") || "").not.toContain("background");
    expect(quote.getAttribute("style") || "").not.toContain("color");
    expect(quote.getAttribute("style") || "").not.toContain("border-left");
  });
});
