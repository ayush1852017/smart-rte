// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyLink, applyTransaction, getNodeAtPath, removeLink, toggleBold } from "smartrte-core";
import { selectionFromDom } from "./domSelectionBridge.js";
import {
  cleanEditorHtml,
  serializeSmartDocument,
  smartDocumentFromEditorRoot,
  smartDocumentFromHtml,
} from "./domSmartDocument.js";
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
  it("round-trips merged table cells without losing spans or covered rows", () => {
    const document = smartDocumentFromHtml(
      '<table><tbody><tr><td colspan="2" rowspan="2"><p>Merged</p></td></tr><tr></tr></tbody></table>',
      window.document,
    );
    const html = serializeSmartDocument(document);
    expect(html).toContain('<td colspan="2" rowspan="2">');
    expect(html).toContain("<tr></tr>");
    expect(smartDocumentFromHtml(html, window.document)).toEqual(document);
  });

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

  it("round-trips checklist state, font families, formulas, images, and media", () => {
    document.body.innerHTML = `
      <div id="editor">
        <ul data-srte-checklist="true" data-srte-checklist-strike="true">
          <li data-srte-checked="true"><button data-srte-check="true"></button><p><span style="font-family:Inter">Task</span></p></li>
        </ul>
        <p>Equation <span data-formula="E=mc^2">$E=mc^2$</span> and <img src="inline.png" alt="Inline">.</p>
        <img src="image.png" alt="Diagram" width="320" height="200">
        <video src="movie.mp4" type="video/mp4" title="Demo"></video>
      </div>`;
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument, html } = smartDocumentFromEditorRoot(editor);

    expect(html).not.toContain("data-srte-check=");
    expect(smartDocument.children[0]).toMatchObject({
      type: "list",
      checklist: true,
      strikeCompleted: true,
      children: [{
        checked: true,
        children: [{
          children: [{ marks: [{ type: "fontFamily", value: "Inter" }] }],
        }],
      }],
    });
    expect(smartDocument.children[1]).toMatchObject({
      children: [
        { type: "text", text: "Equation " },
        { type: "formula", value: "E=mc^2", displayText: "$E=mc^2$" },
        { type: "text", text: " and " },
        { type: "inlineImage", src: "inline.png", alt: "Inline" },
        { type: "text", text: "." },
      ],
    });
    expect(smartDocument.children[2]).toMatchObject({
      type: "image",
      src: "image.png",
      width: 320,
      height: 200,
    });
    expect(smartDocument.children[3]).toMatchObject({
      type: "media",
      src: "movie.mp4",
      mediaType: "video",
      mimeType: "video/mp4",
    });

    const serialized = serializeSmartDocument(smartDocument);
    expect(serialized).toContain('data-srte-checklist="true"');
    expect(serialized).toContain('data-srte-checked="true"');
    expect(serialized).toContain('font-family:Inter');
    expect(serialized).toContain('data-formula="E=mc^2"');
    expect(serialized).toContain('data-srte-inline="true" src="inline.png"');
    expect(serialized).toContain('<img src="image.png"');
    expect(serialized).toContain('<video controls src="movie.mp4"');
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

  it("preserves font-size marks and headings inside list items", () => {
    document.body.innerHTML = '<div id="editor"><ol><li><h3><span style="font-size:24px">Sized heading</span></h3></li></ol></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0, 0, 0])).toMatchObject({ type: "heading", level: 3 });
    expect(getNodeAtPath(smartDocument, [0, 0, 0, 0])).toMatchObject({
      type: "text",
      text: "Sized heading",
      marks: [{ type: "fontSize", valuePx: 24 }],
    });
    expect(serializeSmartDocument(smartDocument)).toContain('font-size:24px');
  });

  it("round-trips block and list-item alignment", () => {
    document.body.innerHTML = '<div id="editor"><p style="text-align:center">Centered</p><ol><li style="text-align:right">Right</li></ol></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0])).toMatchObject({ type: "paragraph", alignment: "center" });
    expect(getNodeAtPath(smartDocument, [1, 0])).toMatchObject({ type: "listItem", alignment: "right" });
    expect(serializeSmartDocument(smartDocument)).toContain('<p style="text-align:center">Centered</p>');
    expect(serializeSmartDocument(smartDocument)).toContain('<li style="text-align:right">');
  });

  it("round-trips code-block alignment", () => {
    document.body.innerHTML = '<div id="editor"><pre style="text-align:justify"><code>const value = 1;</code></pre></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0])).toMatchObject({ type: "codeBlock", alignment: "justify" });
    expect(serializeSmartDocument(smartDocument)).toContain('<pre style="text-align:justify"><code>');
  });

  it("round-trips table cell background and text colors", () => {
    document.body.innerHTML = '<div id="editor"><table><tbody><tr><td style="background-color:#123456;color:#ffffff"><p>Cell</p></td></tr></tbody></table></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0, 0, 0])).toMatchObject({
      type: "tableCell",
      backgroundColor: "rgb(18, 52, 86)",
      textColor: "rgb(255, 255, 255)",
    });
    const html = serializeSmartDocument(smartDocument);
    expect(html).toContain("background-color:rgb(18, 52, 86)");
    expect(html).toContain("color:rgb(255, 255, 255)");
  });

  it("round-trips table column widths and row heights", () => {
    document.body.innerHTML = '<div id="editor"><table><colgroup><col style="width:90px"><col style="width:180px"></colgroup><tbody><tr style="height:48px"><td>A</td><td>B</td></tr></tbody></table></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0])).toMatchObject({
      type: "table",
      columnWidths: [90, 180],
      children: [{ heightPx: 48 }],
    });
    const html = serializeSmartDocument(smartDocument);
    expect(html).toContain('<col style="width:90px">');
    expect(html).toContain('<col style="width:180px">');
    expect(html).toContain('<tr style="height:48px">');
  });

  it("round-trips table cell borders", () => {
    document.body.innerHTML = '<div id="editor"><table><tbody><tr><td style="border:none"><p>A</p></td></tr></tbody></table></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const { document: smartDocument } = smartDocumentFromEditorRoot(editor);

    expect(getNodeAtPath(smartDocument, [0, 0, 0])).toMatchObject({ border: "none" });
    expect(serializeSmartDocument(smartDocument)).toContain('style="border:none"');
  });
});
