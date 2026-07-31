// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { restoreSelectionToDom, selectionFromDom } from "./domSelectionBridge.js";

const createEditor = () => {
  document.body.innerHTML = `
    <div id="editor">
      <p>Before <strong>bold</strong> after</p>
      <blockquote><p>Quoted <em>words</em></p></blockquote>
      <div data-table-wrapper="true">
        <button class="srte-drag-handle" data-srte-drag-handle="true">Move</button>
        <table><tbody><tr><td><p>Cell <strong>text</strong></p></td></tr></tbody></table>
      </div>
    </div>`;
  return document.getElementById("editor") as HTMLElement;
};

const setRange = (range: Range) => {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

describe("DOMSelectionBridge", () => {
  it("resolves a collapsed cursor inside a paragraph", () => {
    const editor = createEditor();
    const text = editor.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    });
  });

  it("keeps inline mark boundaries as separate text paths", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    const before = paragraph.firstChild!;
    const bold = paragraph.querySelector("strong")!.firstChild!;
    const range = document.createRange();
    range.setStart(before, 2);
    range.setEnd(bold, 2);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 1], offset: 2 },
    });
  });

  it("maps a multi-text-node selection across a link and bold text", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    paragraph.innerHTML = 'before <a href="https://example.test">linked</a><strong> bold</strong> after';
    const start = paragraph.firstChild!;
    const end = paragraph.querySelector("strong")!.firstChild!;
    const range = document.createRange();
    range.setStart(start, 3);
    range.setEnd(end, 3);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 2], offset: 3 },
    });
  });

  it("resolves selections inside blockquotes", () => {
    const editor = createEditor();
    const text = editor.querySelector("blockquote p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 5);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [1, 0, 0], offset: 1 },
      focus: { path: [1, 0, 0], offset: 5 },
    });
  });

  it("resolves table-cell content without treating the table wrapper as a selected block", () => {
    const editor = createEditor();
    const text = editor.querySelector("td p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [2, 0, 0, 0, 0], offset: 1 },
      focus: { path: [2, 0, 0, 0, 0], offset: 4 },
    });
  });

  it("rejects selections that start in editor-only UI", () => {
    const editor = createEditor();
    const text = editor.querySelector(".srte-drag-handle")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);

    expect(selectionFromDom(editor, setRange(range))).toBeNull();
  });

  it("counts formulas and images as inline model units", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    paragraph.innerHTML = 'Before<span data-formula="x">rendered formula</span><img src="/x.png">After';
    const after = paragraph.lastChild!;
    const range = document.createRange();
    range.setStart(after, 2);
    range.collapse(true);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 3], offset: 2 },
      focus: { path: [0, 3], offset: 2 },
    });
  });

  it("maps element-boundary carets beside atoms to adjacent text", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    paragraph.innerHTML = 'Before<span data-formula="x">x</span>After';
    const range = document.createRange();
    range.setStart(paragraph, 2);
    range.collapse(true);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    });
  });

  it("restores text selections after atomic inline nodes", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    paragraph.innerHTML = 'Before<img src="/x.png">After';

    expect(restoreSelectionToDom(editor, {
      type: "text",
      anchor: { path: [0, 2], offset: 1 },
      focus: { path: [0, 2], offset: 4 },
    })).toBe(true);
    expect(window.getSelection()?.toString()).toBe("fte");
  });

  it("does not turn a text selection spanning a formula into node selection", () => {
    const editor = createEditor();
    const paragraph = editor.querySelector("p")!;
    paragraph.innerHTML = 'Before<span data-formula="x">x</span>After';
    const before = paragraph.firstChild!;
    const after = paragraph.lastChild!;
    const range = document.createRange();
    range.setStart(before, 3);
    range.setEnd(after, 2);

    expect(selectionFromDom(editor, setRange(range))).toEqual({
      type: "text",
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 2], offset: 2 },
    });
  });
});
