// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyLink, applyTransaction, getNodeAtPath, removeLink, toggleBold } from "smartrte-core";
import { selectionFromDom } from "./domSelectionBridge.js";
import { cleanEditorHtml, smartDocumentFromEditorRoot, serializeSmartDocument } from "./domSmartDocument.js";
import { runShadowCommand } from "./shadowMode.js";

const createEditor = () => {
  document.body.innerHTML = `
    <div id="editor">
      <p>Before <strong>bold</strong></p>
      <div data-table-wrapper="true">
        <button class="srte-drag-handle" data-srte-drag-handle="true">Move</button>
        <div class="srte-table-resize-overlay" data-srte-resize-overlay="true"></div>
        <table><tbody><tr><td><p>Cell <strong>text</strong></p></td></tr></tbody></table>
      </div>
      <span data-srte-selection-marker="true">marker</span>
    </div>`;
  return document.getElementById("editor") as HTMLElement;
};

const setRange = (range: Range) => {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

describe("live SmartDocument adapter", () => {
  it("strips editor UI and creates a clean table model", () => {
    const editor = createEditor();
    const { document: smartDocument, html } = smartDocumentFromEditorRoot(editor);

    expect(html).not.toContain("data-table-wrapper");
    expect(html).not.toContain("srte-drag-handle");
    expect(html).not.toContain("selection-marker");
    expect(smartDocument.children).toHaveLength(2);
    expect(smartDocument.children[1].type).toBe("table");
    expect(getNodeAtPath(smartDocument, [1, 0, 0, 0, 0])).toMatchObject({ type: "text", text: "Cell " });
  });

  it("keeps DOM selection paths aligned after wrapper stripping", () => {
    const editor = createEditor();
    const text = editor.querySelector("td p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    const selection = selectionFromDom(editor, setRange(range));
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(selection).toMatchObject({ type: "text", anchor: { path: [1, 0, 0, 0, 0], offset: 1 } });
    if (!selection || selection.type !== "text") throw new Error("Expected a text selection.");
    expect(getNodeAtPath(smartDocument, selection.anchor.path)).toMatchObject({ type: "text", text: "Cell " });
  });

  it("runs shadow commands without mutating live DOM or calling application callbacks", () => {
    const editor = createEditor();
    const text = editor.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const beforeDom = editor.innerHTML;
    const onChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    runShadowCommand({
      command: toggleBold,
      context: { document: smartDocument, selection },
      state: { document: smartDocument, selection },
      legacyHtml: "<p>legacy mismatch</p>",
      serialize: (state) => serializeSmartDocument(state.document),
    });

    expect(editor.innerHTML).toBe(beforeDom);
    expect(onChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("does not report a mismatch when canonical HTML is equal", () => {
    const editor = createEditor();
    expect(cleanEditorHtml(editor)).toContain("<table>");
  });

  it("preserves headings in cells with sibling paragraphs and marks", () => {
    const editor = createEditor();
    editor.innerHTML = '<table><tbody><tr><td><p>Before</p><h2>Heading <em>two</em></h2><p>After</p></td><td><p>Other</p></td></tr></tbody></table>';
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    expect(getNodeAtPath(smartDocument, [0, 0, 0, 1])).toMatchObject({ type: "heading", level: 2 });
    expect(getNodeAtPath(smartDocument, [0, 0, 0, 1, 1])).toMatchObject({ type: "text", text: "two", marks: [{ type: "italic" }] });
    expect(getNodeAtPath(smartDocument, [0, 0, 1, 0, 0])).toMatchObject({ type: "text", text: "Other" });
  });

  it("runs create-link shadow diagnostics for safe selections without mutating DOM or calling callbacks", () => {
    document.body.innerHTML = '<div id="editor"><p>Link me</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const range = document.createRange();
    range.setStart(editor.querySelector("p")!.firstChild!, 0);
    range.setEnd(editor.querySelector("p")!.firstChild!, 4);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const beforeDom = editor.innerHTML;
    const onChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const transaction = runShadowCommand({
      command: applyLink,
      context: { document: smartDocument, selection },
      input: { href: " https://example.test " },
      state: { document: smartDocument, selection },
      legacyHtml: '<p><a href="https://example.test">Link</a> me</p>',
      serialize: (state) => serializeSmartDocument(state.document),
    });

    expect(transaction?.id).toBe("apply-link");
    expect(editor.innerHTML).toBe(beforeDom);
    expect(window.getSelection()?.toString()).toBe("Link");
    expect(onChange).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("normalizes email and phone inputs in create-link shadow diagnostics", () => {
    document.body.innerHTML = '<div id="editor"><p>Email Phone</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const text = editor.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const emailTransaction = applyLink.execute({ document: smartDocument, selection }, { href: "xyz@gmail.com" });
    const emailHtml = serializeSmartDocument(applyTransaction({ document: smartDocument, selection }, emailTransaction).document);

    range.setStart(text, 6);
    range.setEnd(text, 11);
    const phoneSelection = selectionFromDom(editor, setRange(range))!;
    const phoneTransaction = applyLink.execute({ document: smartDocument, selection: phoneSelection }, { href: "+91 98765 43210" });
    const phoneHtml = serializeSmartDocument(applyTransaction({ document: smartDocument, selection: phoneSelection }, phoneTransaction).document);

    expect(emailHtml).toContain('<a href="mailto:xyz@gmail.com">Email</a>');
    expect(phoneHtml).toContain('<a href="tel:+919876543210">Phone</a>');
    expect(editor.innerHTML).toBe("<p>Email Phone</p>");
  });

  it("skips unsafe create-link shadow diagnostics safely", () => {
    document.body.innerHTML = '<div id="editor"><p>Link me</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const range = document.createRange();
    range.setStart(editor.querySelector("p")!.firstChild!, 0);
    range.setEnd(editor.querySelector("p")!.firstChild!, 4);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const transaction = runShadowCommand({
      command: applyLink,
      context: { document: smartDocument, selection },
      input: { href: "javascript:alert(1)" },
      state: { document: smartDocument, selection },
      legacyHtml: editor.innerHTML,
      serialize: (state) => serializeSmartDocument(state.document),
    });

    expect(transaction).toBeNull();
    expect(editor.innerHTML).toBe("<p>Link me</p>");
    expect(window.getSelection()?.toString()).toBe("Link");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("runs remove-link shadow diagnostics without mutating live DOM", () => {
    document.body.innerHTML = '<div id="editor"><p><a href="https://example.test" target="_blank">Link</a> me</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector("a")!);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const beforeDom = editor.innerHTML;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const transaction = runShadowCommand({
      command: removeLink,
      context: { document: smartDocument, selection },
      state: { document: smartDocument, selection },
      legacyHtml: "<p>Link me</p>",
      serialize: (state) => serializeSmartDocument(state.document),
    });

    expect(transaction?.id).toBe("remove-link");
    expect(editor.innerHTML).toBe(beforeDom);
    expect(window.getSelection()?.toString()).toBe("Link");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps table wrappers out of link shadow serialization", () => {
    document.body.innerHTML = '<div id="editor"><div data-table-wrapper="true"><table><tbody><tr><td><p>cell link</p></td></tr></tbody></table></div></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const text = editor.querySelector("td p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const selection = selectionFromDom(editor, setRange(range))!;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);
    const transaction = applyLink.execute({ document: smartDocument, selection }, { href: "mailto:user@example.test" });
    const html = serializeSmartDocument(applyTransaction({ document: smartDocument, selection }, transaction).document);

    expect(html).toContain('<a href="mailto:user@example.test">cell</a>');
    expect(html).toContain("<td><p>");
    expect(html).not.toContain("data-table-wrapper");
  });

  it("drops unsafe existing link marks from the shadow document", () => {
    document.body.innerHTML = '<div id="editor"><p><a href="javascript:alert(1)">bad</a> safe</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0, 0])).toMatchObject({ type: "text", text: "bad" });
    expect((getNodeAtPath(smartDocument, [0, 0]) as { marks?: unknown[] }).marks).toBeUndefined();
  });
});
