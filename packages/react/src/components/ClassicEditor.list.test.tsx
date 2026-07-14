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

describe("ClassicEditor lists", () => {
  beforeAll(async () => {
    ClassicEditorComponent = (await import("./ClassicEditor.js")).ClassicEditor;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("turns partially selected br-separated lines into complete list items", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"one<br>two<br>three<br>four<br>five"} />);
    });

    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const textNodes = Array.from(editor.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(textNodes[2], 2);
    range.setEnd(textNodes[3], 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const button = host.querySelector('button[title="Bulleted list"]') as HTMLButtonElement;
    act(() => button.click());

    expect(Array.from(editor.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual(["three", "four"]);
    expect(editor.textContent).toBe("onetwothreefourfive");
  });

  it("includes the block that contains a selection endpoint at offset zero", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<p>one</p><p>two</p><p>three</p>"} />);
    });

    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const paragraphs = editor.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 0);
    range.setEnd(paragraphs[1].firstChild!, 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const button = host.querySelector('button[title="Bulleted list"]') as HTMLButtonElement;
    act(() => button.click());

    expect(Array.from(editor.querySelectorAll("ul > li"), (item) => item.textContent)).toEqual(["one", "two"]);
    expect(editor.querySelector(":scope > p")?.textContent).toBe("three");
  });

  it("merges separately styled neighboring ordered lists", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<p>four</p><p>five</p>"} />);
    });

    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const styleSelect = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    const applyAlphaList = (paragraph: HTMLParagraphElement) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      act(() => {
        styleSelect.value = "ordered:lower-alpha";
        styleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    applyAlphaList(editor.querySelector(":scope > p")!);
    applyAlphaList(editor.querySelector(":scope > p")!);

    expect(editor.querySelectorAll("ol")).toHaveLength(1);
    expect(editor.querySelector("ol")?.style.listStyleType).toBe("lower-alpha");
    expect(Array.from(editor.querySelectorAll("li"), (item) => item.textContent)).toEqual(["four", "five"]);
  });

  it("creates an interactive checklist and records its checked state", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<p>task one</p><p>task two</p>"} />);
    });

    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Checklist styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "check:strike";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const list = editor.querySelector('ul[data-srte-checklist="true"]') as HTMLElement;
    const checkbox = list.querySelector("button[data-srte-check]") as HTMLButtonElement;
    act(() => checkbox.click());

    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(checkbox.closest("li")?.dataset.checked).toBe("true");
    expect(checkbox.closest("li")?.style.textDecoration).toBe("line-through");
  });

  it("converts every selected paragraph including the final one", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<p>one</p><p>two</p><p>three</p><p>four</p>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const paragraphs = editor.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 1);
    range.setEnd(paragraphs[2].firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:lower-alpha";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(Array.from(editor.querySelectorAll("ol > li"), (item) => item.textContent)).toEqual(["one", "two", "three"]);
    expect(editor.querySelector(":scope > p")?.textContent).toBe("four");
  });

  it("preserves mixed heading levels when converting blocks to a numbered list", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<h1>one</h1><h2 style="text-align:center">two</h2><h3>three</h3><h4>four</h4>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const headings = editor.querySelectorAll("h1,h2,h3,h4");
    const range = document.createRange();
    range.setStart(headings[0].firstChild!, 0);
    range.setEnd(headings[3].firstChild!, headings[3].textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:decimal";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(Array.from(editor.querySelectorAll("ol > li"), (item) => item.firstElementChild?.tagName)).toEqual([
      "H1", "H2", "H3", "H4",
    ]);
    expect(Array.from(editor.querySelectorAll("ol > li"), (item) => item.textContent)).toEqual([
      "one", "two", "three", "four",
    ]);
    expect((editor.querySelector("ol > li:nth-child(2)") as HTMLElement).style.textAlign).toBe("center");
    expect((editor.querySelector("ol > li:nth-child(2) > h2") as HTMLElement).style.textAlign).toBe("center");
  });

  it("restores preserved headings when a checklist is removed", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<h2>one</h2><h3>two</h3>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const checklist = host.querySelector('button[title="Checklist"]') as HTMLButtonElement;

    act(() => checklist.click());
    expect(editor.querySelector("ul > li > h2")?.textContent).toBe("one");
    expect(editor.querySelector("ul > li > h3")?.textContent).toBe("two");

    const items = editor.querySelectorAll("li");
    const listRange = document.createRange();
    listRange.setStart(items[0].querySelector("h2")!.firstChild!, 0);
    listRange.setEnd(items[1].querySelector("h3")!.firstChild!, 3);
    selection.removeAllRanges();
    selection.addRange(listRange);
    document.dispatchEvent(new Event("selectionchange"));
    act(() => checklist.click());

    expect(Array.from(editor.children, (child) => child.tagName)).toEqual(["H2", "H3"]);
  });

  it("creates a list inside a direct-text table cell without removing the cell", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<table><tbody><tr><td style="border:1px solid red">one<br>two</td><td>keep</td></tr></tbody></table>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const firstCell = editor.querySelector("td") as HTMLElement;
    const textNodes = Array.from(firstCell.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(textNodes[0], 0);
    range.setEnd(textNodes[1], textNodes[1].data.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:lower-roman";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(editor.querySelectorAll("tr > td")).toHaveLength(2);
    expect(editor.querySelector("tr > ol, tbody > ol, table > ol")).toBeNull();
    expect(firstCell.style.border).toContain("red");
    expect(firstCell.querySelector("ol")?.style.listStyleType).toBe("lower-roman");
    expect(Array.from(firstCell.querySelectorAll("ol > li"), (item) => item.textContent)).toEqual(["one", "two"]);
  });

  it("preserves heading blocks when listing structured content inside a table cell", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<table><tbody><tr><td><h2>one</h2><h3>two</h3></td><td>keep</td></tr></tbody></table>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const cell = editor.querySelector("td") as HTMLElement;
    const headings = cell.querySelectorAll("h2,h3");
    const range = document.createRange();
    range.setStart(headings[0].firstChild!, 0);
    range.setEnd(headings[1].firstChild!, headings[1].textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Bulleted list"]') as HTMLButtonElement).click());

    expect(editor.querySelectorAll("tr > td")).toHaveLength(2);
    expect(cell.querySelector("ul > li > h2")?.textContent).toBe("one");
    expect(cell.querySelector("ul > li > h3")?.textContent).toBe("two");
    expect(editor.querySelector("tr > ul, tbody > ul, table > ul")).toBeNull();
  });

  it("indents and outdents the caret item deterministically while preserving the caret", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ol><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const secondText = editor.querySelectorAll("li > p")[1].firstChild!;
    const range = document.createRange();
    range.setStart(secondText, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(editor.querySelector("ol > li:first-child > ol > li > p")?.textContent).toBe("two");
    expect(selection.anchorNode?.textContent).toBe("two");
    expect(selection.anchorOffset).toBe(1);

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(Array.from(editor.querySelectorAll(":scope > ol > li"), (item) => item.textContent)).toEqual(["one", "two", "three"]);
    expect(editor.querySelector(":scope > ol > li > ol")).toBeNull();
    expect(selection.anchorNode?.textContent).toBe("two");
    expect(selection.anchorOffset).toBe(1);
  });

  it("indents a contiguous multi-item selection as one ordered run", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ol><li><p>one</p></li><li><h2>two</h2></li><li><p>three</p></li><li><p>four</p></li></ol>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const items = editor.querySelectorAll(":scope > ol > li");
    const range = document.createRange();
    range.setStart(items[1].querySelector("h2")!.firstChild!, 0);
    range.setEnd(items[2].querySelector("p")!.firstChild!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));

    const nested = editor.querySelector(":scope > ol > li:first-child > ol")!;
    expect(Array.from(nested.children, (item) => item.textContent)).toEqual(["two", "three"]);
    expect(nested.querySelector("li:first-child > h2")?.textContent).toBe("two");
    expect(Array.from(editor.querySelectorAll(":scope > ol > li"), (item) => item.textContent)).toEqual(["onetwothree", "four"]);
    expect(selection.toString()).toBe("twothree");
  });

  it("styles only the selected nested item and leaves its ancestor list unchanged", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<ol style="list-style-type:decimal"><li><p>parent</p><ul style="list-style-type:disc"><li><p>child one</p></li><li><h3>child two</h3></li></ul></li><li><p>outer two</p></li></ol>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const nestedHeading = editor.querySelector("ul > li:nth-child(2) > h3")!;
    const range = document.createRange();
    range.selectNodeContents(nestedHeading);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;

    act(() => {
      styles.value = "ordered:lower-roman";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const outer = editor.querySelector(":scope > ol") as HTMLElement;
    expect(outer.style.listStyleType).toBe("decimal");
    expect(outer.querySelector(":scope > li > p")?.textContent).toBe("parent");
    expect(outer.querySelector('ol[style*="lower-roman"] > li > h3')?.textContent).toBe("child two");
    expect(outer.querySelector("ul > li > p")?.textContent).toBe("child one");
  });

  it("does not convert an existing bullet sublist when indenting an ordered item", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<ol><li><p>one</p><ul style="list-style-type:disc"><li><p>existing bullet</p></li></ul></li><li><p>two</p></li></ol>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const second = editor.querySelector(":scope > ol > li:nth-child(2) > p")!.firstChild!;
    const range = document.createRange();
    range.setStart(second, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));

    const parent = editor.querySelector(":scope > ol > li")!;
    expect(parent.querySelector("ul > li")?.textContent).toBe("existing bullet");
    expect(parent.querySelector("ol > li")?.textContent).toBe("two");
    expect(parent.querySelector("ul")?.getAttribute("style")).toContain("disc");
  });

  it("undoes a nested indent in one history step", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li><p>one</p></li><li><p>two</p></li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const second = editor.querySelectorAll("li > p")[1].firstChild!;
    const range = document.createRange();
    range.setStart(second, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(editor.querySelector("ul > li > ul > li")?.textContent).toBe("two");
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(Array.from(editor.querySelectorAll(":scope > ul > li"), (item) => item.textContent)).toEqual(["one", "two"]);
    expect(editor.querySelector(":scope > ul > li > ul")).toBeNull();
  });

  it("outdents only the selected middle nested item", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li><p>parent</p><ul><li><p>one</p></li><li><h4>two</h4></li><li><p>three</p></li></ul></li><li><p>outer</p></li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const middle = editor.querySelector("ul ul > li:nth-child(2) > h4")!.firstChild!;
    const range = document.createRange();
    range.setStart(middle, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));

    const outerItems = editor.querySelectorAll(":scope > ul > li");
    expect(Array.from(outerItems, (item) => item.querySelector(":scope > p,:scope > h4")?.textContent)).toEqual(["parent", "two", "outer"]);
    expect(Array.from(outerItems[0].querySelectorAll(":scope > ul > li"), (item) => item.textContent)).toEqual(["one", "three"]);
    expect(outerItems[1].querySelector(":scope > h4")?.textContent).toBe("two");
  });

  it("supports deterministic nesting inside a table cell without changing table structure", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<table><tbody><tr><td style="border:1px solid red"><ol><li><p>one</p></li><li><p>two</p></li></ol></td><td>keep</td></tr></tbody></table>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const cell = editor.querySelector("td") as HTMLElement;
    const second = cell.querySelectorAll("li > p")[1].firstChild!;
    const range = document.createRange();
    range.setStart(second, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));

    expect(editor.querySelectorAll("tr > td")).toHaveLength(2);
    expect(cell.style.border).toContain("red");
    expect(cell.querySelector("ol > li > ol > li")?.textContent).toBe("two");
    expect(editor.querySelector("tr > ol, tbody > ol, table > ol")).toBeNull();
  });

  it("creates and unwinds three list depths without losing block content", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ol><li><h2>one</h2></li><li><p>two</p></li><li><h3>three</h3></li></ol>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const texts = () => Array.from(editor.querySelectorAll("h2,p,h3"), (block) => block.firstChild!);
    const selection = window.getSelection()!;
    const selectText = (node: Node) => {
      const range = document.createRange();
      range.setStart(node, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    };

    selectText(texts()[1]);
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    selectText(texts()[2]);
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));

    expect(editor.querySelector("ol > li > ol > li > ol > li > h3")?.textContent).toBe("three");
    expect(editor.querySelector("ol > li > h2")?.textContent).toBe("one");
    expect(editor.querySelector("ol > li > ol > li > p")?.textContent).toBe("two");

    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(Array.from(editor.querySelectorAll(":scope > ol > li"), (item) => item.querySelector(":scope > h2,:scope > p,:scope > h3")?.textContent)).toEqual(["one", "three"]);
  });

  it("uses the same deterministic depth command from the move toolbar", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const items = editor.querySelectorAll(":scope > ul > li");
    const range = document.createRange();
    range.setStart(items[1].querySelector("p")!.firstChild!, 0);
    range.setEnd(items[2].querySelector("p")!.firstChild!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Move selected block right"]') as HTMLButtonElement).click());
    expect(Array.from(editor.querySelectorAll(":scope > ul > li:first-child > ul > li"), (item) => item.textContent)).toEqual(["two", "three"]);
    expect(selection.toString()).toBe("twothree");
  });

  it("applies code formatting to the selected nested item rather than its ancestor", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const child = editor.querySelector("ul ul > li > p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(child);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Code block"]') as HTMLButtonElement).click());
    expect(editor.querySelector("ul ul > li > pre > code")?.textContent).toBe("child");
    expect(editor.querySelector(":scope > ul > li > pre")).toBeNull();
    expect(editor.querySelector(":scope > ul > li > p")?.textContent).toBe("parent");
  });

  it("converts selected checklist items to numbering without checklist controls", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={'<ul data-srte-checklist="true" data-srte-checklist-strike="false" style="list-style-type:none"><li><input type="checkbox" data-srte-check="true">one</li><li><input type="checkbox" data-srte-check="true">two</li></ul>'} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const items = editor.querySelectorAll("li");
    const range = document.createRange();
    range.setStart(items[0].lastChild!, 0);
    range.setEnd(items[1].lastChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:decimal";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(editor.querySelectorAll("ol > li")).toHaveLength(2);
    expect(editor.querySelector("[data-srte-checklist], [data-srte-check]")).toBeNull();
  });

  it("splits an existing list when only middle items change type", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const items = editor.querySelectorAll("li");
    const range = document.createRange();
    range.selectNodeContents(items[1]);
    range.setEnd(items[2].firstChild!, items[2].textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:decimal";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(Array.from(editor.children, (node) => node.tagName)).toEqual(["UL", "OL", "UL"]);
    expect(Array.from(editor.querySelectorAll("ol > li"), (item) => item.textContent)).toEqual(["two", "three"]);
  });

  it("converts a mixed selection of existing list items and plain lines", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(
        <ClassicEditorComponent
          value={"<ol><li>dnkejdlewdlede</li><li>kelwdekldleded</li></ol><p>edkelwdkelde</p><p>dekdlewkdlewkdled</p>"}
        />
      );
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const firstItem = editor.querySelector("li")!;
    const paragraphs = editor.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(firstItem.firstChild!, 0);
    range.setEnd(paragraphs[1].firstChild!, paragraphs[1].textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const styles = host.querySelector('select[aria-label="Numbered list styles"]') as HTMLSelectElement;
    act(() => {
      styles.value = "ordered:lower-roman";
      styles.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(editor.querySelectorAll("ol")).toHaveLength(1);
    expect(editor.querySelector("ol")?.style.listStyleType).toBe("lower-roman");
    expect(Array.from(editor.querySelectorAll("ol > li"), (item) => item.textContent)).toEqual([
      "dnkejdlewdlede",
      "kelwdekldleded",
      "edkelwdkelde",
      "dekdlewkdlewkdled",
    ]);
  });

  it("wraps only the selected run of list items in a blockquote", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const items = editor.querySelectorAll("li");
    const range = document.createRange();
    range.setStart(items[1].firstChild!, 0);
    range.setEnd(items[2].firstChild!, items[2].textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Blockquote"]') as HTMLButtonElement).click());

    expect(Array.from(editor.children, (node) => node.tagName)).toEqual(["UL", "BLOCKQUOTE", "UL"]);
    expect(Array.from(editor.querySelectorAll("blockquote li"), (item) => item.textContent)).toEqual(["two", "three"]);
  });

  it("wraps the whole list when the caret is inside one list item", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ol><li>one</li><li>two</li><li>three</li><li>four</li><li>five</li></ol>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const thirdItem = editor.querySelectorAll("li")[2];
    const range = document.createRange();
    range.setStart(thirdItem.firstChild!, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Blockquote"]') as HTMLButtonElement).click());

    expect(editor.querySelectorAll(":scope > blockquote")).toHaveLength(1);
    expect(editor.querySelectorAll("blockquote > ol > li")).toHaveLength(5);
    expect(editor.querySelector("blockquote > ol > li:nth-child(3)")?.textContent).toBe("three");
  });

  it("wraps mixed list and paragraph selections in one blockquote", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ol><li>one</li><li>two</li></ol><p>three</p>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const range = document.createRange();
    range.setStart(editor.querySelector("li")!.firstChild!, 0);
    range.setEnd(editor.querySelector("p")!.firstChild!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    act(() => (host!.querySelector('button[title="Blockquote"]') as HTMLButtonElement).click());

    expect(editor.querySelectorAll(":scope > blockquote")).toHaveLength(1);
    expect(Array.from(editor.querySelectorAll("blockquote > ol > li"), (item) => item.textContent)).toEqual(["one", "two"]);
    expect(editor.querySelector("blockquote > p")?.textContent).toBe("three");
  });

  it("toggles code blocks inside selected list items without removing the list", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<ul><li>const one = 1;</li><li>const two = 2;</li></ul>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    const selectItems = () => {
      const items = editor.querySelectorAll("li");
      const range = document.createRange();
      range.setStart(items[0], 0);
      range.setEnd(items[1], items[1].childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    };
    selectItems();
    const button = host.querySelector('button[title="Code block"]') as HTMLButtonElement;
    act(() => button.click());

    expect(editor.querySelectorAll("ul > li > pre > code")).toHaveLength(2);
    expect(editor.querySelectorAll("ul > li")).toHaveLength(2);

    selectItems();
    act(() => button.click());
    expect(editor.querySelector("pre")).toBeNull();
    expect(Array.from(editor.querySelectorAll("li"), (item) => item.textContent)).toEqual(["const one = 1;", "const two = 2;"]);
  });
});
