// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  executeDomInlineImageCommand,
  executeDomInlineImageUpdate,
} from "./domInlineImageCommandBridge.js";

describe("DOM inline image command bridge", () => {
  it("inserts one atomic image without replacing surrounding DOM", () => {
    document.body.innerHTML = '<div id="editor"><p style="color:red">before</p><p>after</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const paragraph = root.firstElementChild as HTMLElement;
    const text = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const image = executeDomInlineImageCommand(root, {
      src: "/inline.png",
      alt: "Inline",
    }, selection);

    expect(root.firstElementChild).toBe(paragraph);
    expect(paragraph.style.color).toBe("red");
    expect(paragraph.textContent).toBe("before");
    expect(image?.parentElement).toBe(paragraph);
    expect(image?.dataset.srteInline).toBe("true");
    expect(root.lastElementChild?.textContent).toBe("after");
    expect(selection.anchorNode).toBe(paragraph);
  });

  it("declines a non-collapsed selection", () => {
    document.body.innerHTML = '<div id="editor"><p>before</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(executeDomInlineImageCommand(root, { src: "/x.png" }, selection)).toBeNull();
  });

  it("updates image dimensions through core without replacing the image", () => {
    document.body.innerHTML = '<div id="editor"><p>A<img src="/x.png" alt="Existing image">B</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const image = root.querySelector("img") as HTMLImageElement;
    expect(executeDomInlineImageUpdate(root, image, { width: 240, height: 120 })).toBe(true);
    expect(root.querySelector("img")).toBe(image);
    expect(image.width).toBe(240);
    expect(image.height).toBe(120);
  });
});
