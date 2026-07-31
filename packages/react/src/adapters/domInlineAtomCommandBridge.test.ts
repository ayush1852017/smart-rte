// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  adjacentInlineAtom,
  executeDomFormulaInsert,
  executeDomInlineAtomDelete,
  inlineAtomPathFromDom,
} from "./domInlineAtomCommandBridge.js";

describe("DOM inline atom command bridge", () => {
  it("deletes an inline image through core without replacing its paragraph", () => {
    document.body.innerHTML = '<div id="editor"><p>Before<img src="/x.png">After</p><p>Other</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const paragraph = root.firstElementChild as HTMLElement;
    const image = root.querySelector("img") as HTMLElement;
    expect(inlineAtomPathFromDom(root, image)).toEqual([0, 1]);
    expect(executeDomInlineAtomDelete(root, image)).toBe(true);
    expect(root.firstElementChild).toBe(paragraph);
    expect(paragraph.textContent).toBe("BeforeAfter");
    expect(root.lastElementChild?.textContent).toBe("Other");
  });

  it("finds atoms directly adjacent to an element-boundary caret", () => {
    document.body.innerHTML = '<p>Before<span data-formula="x">x</span>After</p>';
    const paragraph = document.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph, 2);
    range.collapse(true);
    expect(adjacentInlineAtom(range, "backward")?.dataset.formula).toBe("x");
    expect(adjacentInlineAtom(range, "forward")).toBeNull();
  });

  it("inserts a formula through core without replacing its paragraph", () => {
    document.body.innerHTML = '<div id="editor"><p>Before After</p><p>Other</p></div>';
    const root = document.getElementById("editor")!;
    const paragraph = root.firstElementChild as HTMLElement;
    const text = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(text, 7);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const formula = executeDomFormulaInsert(root, {
      value: "x^2",
      displayText: "$x^2$",
    });
    expect(formula?.dataset.formula).toBe("x^2");
    expect(formula?.textContent).toBe("$x^2$");
    expect(root.firstElementChild).toBe(paragraph);
    expect(root.lastElementChild?.textContent).toBe("Other");
  });
});
