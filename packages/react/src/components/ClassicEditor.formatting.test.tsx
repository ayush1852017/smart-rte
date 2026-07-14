// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type TestGlobal = typeof globalThis & { DOMMatrix?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as TestGlobal).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as TestGlobal).DOMMatrix = class DOMMatrix {} as unknown as typeof DOMMatrix;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ClassicEditorComponent: React.ComponentType<{ value?: string }>;

const renderEditor = (value: string) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(<ClassicEditorComponent value={value} />);
  });
  return host.querySelector('[contenteditable="true"]') as HTMLElement;
};

const setRange = (start: Node, startOffset: number, end = start, endOffset = startOffset) => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => document.dispatchEvent(new Event("selectionchange")));
};

describe("ClassicEditor headings and font size", () => {
  beforeAll(async () => {
    ClassicEditorComponent = (await import("./ClassicEditor.js")).ClassicEditor;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("changes every selected paragraph to the requested heading", () => {
    const editor = renderEditor("<p>one</p><p>two</p><p>three</p>");
    const paragraphs = editor.querySelectorAll("p");
    setRange(paragraphs[0].firstChild!, 1, paragraphs[2].firstChild!, 3);
    const control = host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement;
    act(() => {
      control.value = "h2";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(Array.from(editor.children, (node) => node.tagName)).toEqual(["H2", "H2", "H2"]);
  });

  it("changes list-item content to a heading without removing the list", () => {
    const editor = renderEditor("<ol><li>one</li><li>two</li></ol>");
    const second = editor.querySelectorAll("li")[1];
    setRange(second.firstChild!, 1);
    const control = host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement;
    act(() => {
      control.value = "h3";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(editor.querySelectorAll("ol > li")).toHaveLength(2);
    expect(editor.querySelector("ol > li:nth-child(2) > h3")?.textContent).toBe("two");
  });

  it("removes an explicit font size when text becomes a heading", () => {
    const editor = renderEditor('<p><span style="font-size:36px"><strong>Large text</strong></span></p>');
    const text = editor.querySelector("strong")!.firstChild!;
    setRange(text, 2);
    const control = host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement;
    act(() => {
      control.value = "h3";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(editor.querySelector("h3")?.textContent).toBe("Large text");
    expect(editor.querySelector("h3 [style*='font-size']")).toBeNull();
    expect(editor.querySelector("h3 strong")?.textContent).toBe("Large text");
  });

  it("applies font size across blocks without wrapping block elements", () => {
    const editor = renderEditor("<p>one</p><p>two</p><p>three</p>");
    const paragraphs = editor.querySelectorAll("p");
    setRange(paragraphs[0].firstChild!, 1, paragraphs[2].firstChild!, 2);
    const control = host!.querySelector('select[title="Font Size"]') as HTMLSelectElement;
    act(() => {
      control.value = "24";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(editor.querySelector("span > p, span > h1, span > ol, span > ul")).toBeNull();
    expect(editor.querySelectorAll('span[style*="font-size: 24px"]')).toHaveLength(3);
    expect(Array.from(editor.children, (node) => node.tagName)).toEqual(["P", "P", "P"]);
  });

  it("does not insert invisible content when font size is chosen at a caret", () => {
    const editor = renderEditor("<p>hello</p>");
    const text = editor.querySelector("p")!.firstChild!;
    setRange(text, 2);
    const before = editor.innerHTML;
    const control = host!.querySelector('select[title="Font Size"]') as HTMLSelectElement;
    act(() => {
      control.value = "18";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(editor.innerHTML).toBe(before);
    expect(editor.textContent).not.toContain("\u200B");
  });

  it("applies a pending caret font size to subsequently typed text", () => {
    const editor = renderEditor("<p>hello</p>");
    const text = editor.querySelector("p")!.firstChild!;
    setRange(text, 5);
    const control = host!.querySelector('select[title="Font Size"]') as HTMLSelectElement;
    act(() => {
      control.value = "18";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      editor.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "!",
        inputType: "insertText",
      }));
    });
    expect(editor.querySelector('span[style*="font-size: 18px"]')?.textContent).toBe("!");
    expect(editor.textContent).toBe("hello!");
  });

  it("reports mixed heading state and the explicit size at the caret", () => {
    const editor = renderEditor('<h2>Heading</h2><p><span style="font-size:24px">sized</span></p>');
    const heading = editor.querySelector("h2")!;
    const sizedText = editor.querySelector("span")!.firstChild!;
    setRange(heading.firstChild!, 0, sizedText, sizedText.textContent!.length);
    expect((host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement).value).toBe("mixed");

    setRange(sizedText, 2);
    expect((host!.querySelector('select[title="Font Size"]') as HTMLSelectElement).value).toBe("24");
  });

  it("centers every block touched by an expanded selection", () => {
    const editor = renderEditor("<p>one</p><p>two</p><p>three</p>");
    const paragraphs = editor.querySelectorAll("p");
    setRange(paragraphs[0].firstChild!, 1, paragraphs[2].firstChild!, 2);
    act(() => (host!.querySelector('button[aria-label="Align center"]') as HTMLButtonElement).click());
    expect(Array.from(paragraphs, (paragraph) => paragraph.style.textAlign)).toEqual(["center", "center", "center"]);
  });

  it("aligns only the list item containing a collapsed caret", () => {
    const editor = renderEditor("<ol><li>one</li><li>two</li><li>three</li></ol>");
    const items = editor.querySelectorAll("li");
    setRange(items[1].firstChild!, 1);
    act(() => (host!.querySelector('button[aria-label="Align right"]') as HTMLButtonElement).click());
    expect(Array.from(items, (item) => item.style.textAlign)).toEqual(["", "right", ""]);
  });

  it("reports mixed alignment and preserves alignment through heading conversion", () => {
    const editor = renderEditor('<p style="text-align:center">one</p><p>two</p>');
    const paragraphs = editor.querySelectorAll("p");
    setRange(paragraphs[0].firstChild!, 0, paragraphs[1].firstChild!, 3);
    expect(host!.querySelector('button[aria-label="Align center"]')?.getAttribute("aria-pressed")).toBe("false");

    setRange(paragraphs[0].firstChild!, 1);
    const control = host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement;
    act(() => {
      control.value = "h3";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((editor.querySelector("h3") as HTMLElement).style.textAlign).toBe("center");
  });

  it("aligns direct content in an editor-generated table cell", () => {
    const editor = renderEditor('<div data-table-wrapper="true"><table><tbody><tr><td>&nbsp;</td></tr></tbody></table></div>');
    const cell = editor.querySelector("td") as HTMLElement;
    setRange(cell.firstChild!, 1);
    act(() => (host!.querySelector('button[aria-label="Align center"]') as HTMLButtonElement).click());
    expect(cell.style.textAlign).toBe("center");
  });

  it("aligns a paragraph nested in a table cell", () => {
    const editor = renderEditor('<table><tbody><tr><td><p>cell text</p></td></tr></tbody></table>');
    const paragraph = editor.querySelector("td p") as HTMLElement;
    setRange(paragraph.firstChild!, 3);
    act(() => (host!.querySelector('button[aria-label="Align right"]') as HTMLButtonElement).click());
    expect(paragraph.style.textAlign).toBe("right");
  });

  it("aligns a code block", () => {
    const editor = renderEditor("<pre><code>const value = 1;</code></pre>");
    const code = editor.querySelector("code")!;
    setRange(code.firstChild!, 4);
    act(() => (host!.querySelector('button[aria-label="Align right"]') as HTMLButtonElement).click());
    expect((editor.querySelector("pre") as HTMLElement).style.textAlign).toBe("right");
  });
});
