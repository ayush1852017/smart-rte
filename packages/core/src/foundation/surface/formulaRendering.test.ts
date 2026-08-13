// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSubtreeRenderer } from "./index.js";
import type { SmartDocument, SmartSelection } from "../types.js";

const caret = (offset: number, path = [0]): SmartSelection => ({
  type: "text", anchor: { path, offset }, head: { path, offset },
});

const documentWithFormula = (source: string): SmartDocument => ({
  type: "doc", id: "doc", children: [
    { type: "paragraph", id: "p0", children: [{ type: "formula", id: "f0", attrs: { source, notation: "latex" } }] },
  ],
});

describe("Phase 9 SS2.4 live KaTeX rendering", () => {
  it("renders real HTML and MathML output, not the raw LaTeX source as plain text", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(documentWithFormula("x^2"), caret(0));

    const element = renderer.mapping.nodeToDom("f0")!;
    expect(element.querySelector(".katex")).not.toBeNull();
    expect(element.querySelector("math")).not.toBeNull(); // MathML, for accessibility
    // The raw source must not be the element's rendered text - if it were,
    // this would mean rendering silently fell back to plain text again.
    expect(element.textContent).not.toBe("x^2");
    expect(element.textContent?.length).toBeGreaterThan(0);
  });

  it("keeps the accessible-name contract (role=math, aria-label, data-smart-formula) alongside the rendered math", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(documentWithFormula("x^2"), caret(0));

    const element = renderer.mapping.nodeToDom("f0")!;
    expect(element.getAttribute("role")).toBe("math");
    expect(element.getAttribute("aria-label")).toBe("Mathematical formula: x^2");
    expect(element.getAttribute("data-smart-formula")).toBe("x^2");
  });

  it("re-renders when the formula source changes and leaves other content alone", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(documentWithFormula("x^2"), caret(0));
    const element = renderer.mapping.nodeToDom("f0")!;
    const firstRenderHtml = element.innerHTML;

    renderer.render(documentWithFormula("y^3"), caret(0));
    expect(renderer.mapping.nodeToDom("f0")).toBe(element); // same DOM identity, not recreated
    expect(element.innerHTML).not.toBe(firstRenderHtml);
    expect(element.getAttribute("data-smart-formula")).toBe("y^3");

    // Re-rendering with the same source again should not thrash the DOM.
    const stableHtml = element.innerHTML;
    renderer.render(documentWithFormula("y^3"), caret(0));
    expect(element.innerHTML).toBe(stableHtml);
  });

  it("falls back to the raw source as plain text for invalid LaTeX instead of throwing", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    // Unbalanced brace - genuinely invalid, a realistic mid-typing state.
    expect(() => renderer.render(documentWithFormula("\\frac{1"), caret(0))).not.toThrow();
    const element = renderer.mapping.nodeToDom("f0")!;
    expect(element.textContent).toBe("\\frac{1");
  });

  it("rejects untrusted commands per trust:false (does not allow \\includegraphics or similar)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(documentWithFormula("\\includegraphics{https://evil.test/x.png}"), caret(0));
    const element = renderer.mapping.nodeToDom("f0")!;
    // trust:false makes KaTeX either throw (caught -> plain-text fallback)
    // or render an inert error span - either way, no actual <img> gets
    // injected into the live document from formula content.
    expect(element.querySelector("img")).toBeNull();
  });
});
