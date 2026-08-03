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

  it("preserves an explicit font size when text becomes a heading", () => {
    const editor = renderEditor('<p><span style="font-size:36px"><strong>Large text</strong></span></p>');
    const text = editor.querySelector("strong")!.firstChild!;
    setRange(text, 2);
    const control = host!.querySelector('select[title="Paragraph/Heading"]') as HTMLSelectElement;
    act(() => {
      control.value = "h3";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(editor.querySelector("h3")?.textContent).toBe("Large text");
    expect((editor.querySelector("h3 [style*='font-size']") as HTMLElement).style.fontSize).toBe("36px");
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

  it("applies text color across blocks without wrapping block elements", () => {
    const editor = renderEditor("<p>one</p><p>two</p>");
    const paragraphs = editor.querySelectorAll("p");
    setRange(paragraphs[0].firstChild!, 1, paragraphs[1].firstChild!, 2);
    act(() => (host!.querySelector('button[aria-label="Text color"]') as HTMLButtonElement).click());
    act(() => (host!.querySelector('button[title="#ff0000"]') as HTMLButtonElement).click());
    expect(editor.querySelector("span > p")).toBeNull();
    expect(editor.querySelectorAll('span[style*="color: rgb(255, 0, 0)"]')).toHaveLength(2);
  });

  it("highlights only selected table-cell text without changing its text color", () => {
    const editor = renderEditor('<table><tbody><tr><td><p>cell text</p></td></tr></tbody></table>');
    const text = editor.querySelector("td p")!.firstChild!;
    setRange(text, 0, text, 4);
    act(() => (host!.querySelector('button[aria-label="Background color"]') as HTMLButtonElement).click());
    act(() => (host!.querySelector('button[title="#ffff00"]') as HTMLButtonElement).click());
    const cell = editor.querySelector("td") as HTMLElement;
    const highlight = cell.querySelector("span") as HTMLElement;
    expect(cell.style.backgroundColor).toBe("");
    expect(highlight.style.backgroundColor).toBe("rgb(255, 255, 0)");
    expect(highlight.style.color).toBe("");
    expect(highlight.textContent).toBe("cell");
  });

  it("shows the foreground and background colors at the caret in the toolbar", () => {
    const editor = renderEditor('<p><span style="color:#1155cc;background-color:#fff2cc">colored</span></p>');
    const text = editor.querySelector("span")!.firstChild!;
    setRange(text, 2);
    const textIndicator = host!.querySelector('button[aria-label="Text color"] span') as HTMLElement;
    const backgroundIndicator = host!.querySelector('button[aria-label="Background color"] span') as HTMLElement;
    expect(textIndicator.style.borderBottomColor).toBe("rgb(17, 85, 204)");
    expect(backgroundIndicator.style.backgroundColor).toBe("rgb(255, 242, 204)");
  });

  it("keeps the table context menu mounted while dragging its fill picker", () => {
    const editor = renderEditor('<table><tbody><tr><td><p>cell</p></td></tr></tbody></table>');
    const cell = editor.querySelector("td") as HTMLTableCellElement;
    act(() => cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const picker = host!.querySelector('input[type="color"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    act(() => picker.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => {
      picker.value = "#ff0000";
      picker.dispatchEvent(new InputEvent("input", { bubbles: true }));
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelector('input[type="color"]')).toBe(picker);
    expect(cell.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("inserts a formula at the saved caret after the formula dialog takes focus", () => {
    const editor = renderEditor("<p>beforeafter</p>");
    const text = editor.querySelector("p")!.firstChild!;
    setRange(text, 6);

    act(() => (host!.querySelector('button[title="Insert formula"]') as HTMLButtonElement).click());
    const input = host!.querySelector('input[placeholder^="Type LaTeX"]') as HTMLInputElement;
    act(() => input.focus());
    const insert = Array.from(host!.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Insert") as HTMLButtonElement;
    act(() => insert.click());

    const paragraph = editor.querySelector("p")!;
    expect(paragraph.textContent).toBe("before$E=mc^2$after");
    expect(paragraph.querySelector('[data-formula="E=mc^2"]')).not.toBeNull();
  });

  it("turns superscript off at a caret without changing surrounding script text", () => {
    const editor = renderEditor("<p>x<sup>23</sup>y</p>");
    const scripted = editor.querySelector("sup")!.firstChild!;
    setRange(scripted, 1);
    act(() => (host!.querySelector('button[title="Superscript"]') as HTMLButtonElement).click());
    expect(host!.querySelector('button[title="Superscript"]')?.getAttribute("aria-pressed")).toBe("false");
    act(() => editor.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "a",
      inputType: "insertText",
    })));
    expect(editor.innerHTML).toBe("<p>x<sup>2</sup>a<sup>3</sup>y</p>");
  });

  it("applies a pending script to typed text and keeps script types exclusive", () => {
    const editor = renderEditor("<p>x2</p>");
    const text = editor.querySelector("p")!.firstChild!;
    setRange(text, 1, text, 2);
    act(() => (host!.querySelector('button[title="Superscript"]') as HTMLButtonElement).click());
    expect(editor.innerHTML).toBe("<p>x<sup>2</sup></p>");

    const superscript = editor.querySelector("sup")!.firstChild!;
    setRange(superscript, 0, superscript, 1);
    act(() => (host!.querySelector('button[title="Subscript"]') as HTMLButtonElement).click());
    expect(editor.innerHTML).toBe("<p>x<sub>2</sub></p>");
    expect(editor.querySelector("sup")).toBeNull();
  });

  it("exposes partial mark coverage as an indeterminate pressed state", () => {
    const editor = renderEditor("<p><strong>bold</strong> plain</p>");
    const bold = editor.querySelector("strong")!.firstChild!;
    const plain = editor.querySelector("p")!.lastChild!;
    setRange(bold, 0, plain, plain.textContent!.length);

    const button = host!.querySelector('button[title="Bold"]') as HTMLButtonElement;
    expect(button.getAttribute("aria-pressed")).toBe("mixed");
    expect(button.dataset.srteMarkCoverage).toBe("partial");
  });
});
