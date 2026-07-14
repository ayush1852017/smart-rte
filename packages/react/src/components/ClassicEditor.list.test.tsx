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
    expect(editor.querySelector("p")?.textContent).toBe("three");
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

    applyAlphaList(editor.querySelector("p")!);
    applyAlphaList(editor.querySelector("p")!);

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
    expect(editor.querySelector("p")?.textContent).toBe("four");
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
