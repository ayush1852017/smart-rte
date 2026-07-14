import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  applyLink,
  applyFontSize,
  paragraph,
  removeLink,
  toggleBold,
  toggleItalic,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
  updateLink,
  type SmartDocument,
  type SmartEditorState,
} from "../index.js";

const stateFor = (document: SmartDocument, path: readonly number[], start: number, end: number): SmartEditorState => ({
  document,
  selection: {
    type: "text",
    anchor: { path, offset: start },
    focus: { path, offset: end },
  },
});

describe("inline mark commands", () => {
  it("applies and replaces a font-size mark", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("hello")] };
    const state = stateFor(document, [0, 0], 0, 5);
    const sized = applyTransaction(state, applyFontSize.execute(state, 24));
    const resized = applyTransaction(sized, applyFontSize.execute(sized, 18));

    expect((resized.document.children[0] as any).children[0].marks).toEqual([
      { type: "fontSize", valuePx: 18 },
    ]);
  });
  it("marks only the selected text and preserves adjacent text", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("hello"), paragraph("unchanged")] };
    const state = stateFor(document, [0, 0], 1, 4);

    const transaction = toggleBold.execute({ ...state, now: () => 10 });
    const next = applyTransaction(state, transaction);

    expect(next.document.children).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "h" },
          { type: "text", text: "ell", marks: [{ type: "bold" }] },
          { type: "text", text: "o" },
        ],
      },
      paragraph("unchanged"),
    ]);
    expect(transaction.addToHistory).toBe(true);
    expect(transaction.timestamp).toBe(10);
  });

  it("preserves existing links and colors while adding a mark", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [{
          type: "text",
          text: "linked",
          marks: [
            { type: "link", href: "https://example.test" },
            { type: "textColor", value: "#1155cc" },
          ],
        }],
      }],
    };
    const state = stateFor(document, [0, 0], 0, 6);
    const next = applyTransaction(state, toggleUnderline.execute(state));
    const marks = (next.document.children[0] as { children: Array<{ marks?: unknown[] }> }).children[0].marks;

    expect(marks).toEqual([
      { type: "link", href: "https://example.test" },
      { type: "textColor", value: "#1155cc" },
      { type: "underline" },
    ]);
  });

  it("marks a selection spanning adjacent marked text nodes without changing unselected text", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", text: "before " },
          { type: "text", text: "linked", marks: [{ type: "link", href: "https://example.test" }] },
          { type: "text", text: " after" },
        ],
      }],
    };
    const state: SmartEditorState = {
      document,
      selection: { type: "text", anchor: { path: [0, 0], offset: 3 }, focus: { path: [0, 2], offset: 3 } },
    };
    const next = applyTransaction(state, toggleItalic.execute(state));

    expect((next.document.children[0] as any).children).toEqual([
      { type: "text", text: "bef" },
      { type: "text", text: "ore ", marks: [{ type: "italic" }] },
      { type: "text", text: "linked", marks: [{ type: "link", href: "https://example.test" }, { type: "italic" }] },
      { type: "text", text: " af", marks: [{ type: "italic" }] },
      { type: "text", text: "ter" },
    ]);
  });

  it("works inside table cells and blockquotes without affecting neighbours", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [
        {
          type: "table",
          children: [{
            type: "tableRow",
            children: [{ type: "tableCell", children: [paragraph("cell")] }],
          }],
        },
        { type: "blockquote", children: [paragraph("quote")] },
      ],
    };
    const tableState = stateFor(document, [0, 0, 0, 0, 0], 0, 4);
    const tableNext = applyTransaction(tableState, toggleItalic.execute(tableState));
    const quoteState = stateFor(tableNext.document, [1, 0, 0], 0, 5);
    const next = applyTransaction(quoteState, toggleBold.execute(quoteState));

    const tableText = (((next.document.children[0] as any).children[0].children[0].children[0].children[0]) as { marks?: unknown[] });
    const quoteText = (((next.document.children[1] as any).children[0].children[0]) as { marks?: unknown[] });
    expect(tableText.marks).toEqual([{ type: "italic" }]);
    expect(quoteText.marks).toEqual([{ type: "bold" }]);
  });

  it("toggles superscript and subscript without changing unselected text", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("x2 y3")] };
    const superscriptState = stateFor(document, [0, 0], 1, 2);
    const superscripted = applyTransaction(superscriptState, toggleSuperscript.execute(superscriptState));
    const subscriptState = stateFor(superscripted.document, [0, 2], 2, 3);
    const next = applyTransaction(subscriptState, toggleSubscript.execute(subscriptState));

    expect((next.document.children[0] as any).children).toEqual([
      { type: "text", text: "x" },
      { type: "text", text: "2", marks: [{ type: "superscript" }] },
      { type: "text", text: " y" },
      { type: "text", text: "3", marks: [{ type: "subscript" }] },
    ]);
  });

  it("replaces the opposite script mark instead of nesting script types", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [{ type: "text", text: "2", marks: [{ type: "superscript" }] }],
      }],
    };
    const state = stateFor(document, [0, 0], 0, 1);
    const next = applyTransaction(state, toggleSubscript.execute(state));

    expect((next.document.children[0] as any).children).toEqual([
      { type: "text", text: "2", marks: [{ type: "subscript" }] },
    ]);
  });

  it("rejects non-text selections", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("text")] };
    expect(toggleBold.isEnabled({ document, selection: { type: "node", path: [0] } })).toBe(false);
  });
});

describe("link mark commands", () => {
  it("applies a sanitized link to selected text only", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("before selected after")] };
    const state = stateFor(document, [0, 0], 7, 15);

    const next = applyTransaction(state, applyLink.execute(state, { href: " example.test/path " }));

    expect((next.document.children[0] as any).children).toEqual([
      { type: "text", text: "before " },
      { type: "text", text: "selected", marks: [{ type: "link", href: "https://example.test/path" }] },
      { type: "text", text: " after" },
    ]);
  });

  it("updates an existing link while preserving other marks", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [{ type: "text", text: "linked", marks: [{ type: "link", href: "https://old.test" }, { type: "bold" }, { type: "textColor", value: "#1155cc" }] }],
      }],
    };
    const state = stateFor(document, [0, 0], 0, 6);
    const next = applyTransaction(state, updateLink.execute(state, { href: "mailto:user@example.test", target: "_blank" }));

    expect((next.document.children[0] as any).children[0].marks).toEqual([
      { type: "bold" },
      { type: "textColor", value: "#1155cc" },
      { type: "link", href: "mailto:user@example.test", target: "_blank" },
    ]);
  });

  it("removes a link without removing other marks", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "paragraph",
        children: [
          { type: "text", text: "linked", marks: [{ type: "link", href: "https://example.test" }, { type: "italic" }, { type: "underline" }] },
          { type: "text", text: " plain" },
        ],
      }],
    };
    const state = stateFor(document, [0, 0], 0, 6);
    const next = applyTransaction(state, removeLink.execute(state));

    expect((next.document.children[0] as any).children).toEqual([
      { type: "text", text: "linked", marks: [{ type: "italic" }, { type: "underline" }] },
      { type: "text", text: " plain" },
    ]);
  });

  it.each(["javascript:alert(1)", " vbscript:msgbox(1)", "file:///etc/passwd", "data:text/html,<script>alert(1)</script>", "relative/path"])(
    "rejects unsafe href %s",
    (href) => {
      const document: SmartDocument = { type: "doc", children: [paragraph("link")] };
      const state = stateFor(document, [0, 0], 0, 4);

      expect(applyLink.isEnabled(state, { href })).toBe(false);
      expect(() => applyLink.execute(state, { href })).toThrow("safe href");
    },
  );

  it.each(["http://example.test", "https://example.test", "example.test", "user@example.test", "mailto:user@example.test", "+1 555 123 4567", "tel:+15551234567"])(
    "accepts safe href %s",
    (href) => {
      const document: SmartDocument = { type: "doc", children: [paragraph("link")] };
      const state = stateFor(document, [0, 0], 0, 4);

      expect(applyLink.isEnabled(state, { href })).toBe(true);
    },
  );

  it("applies links inside table cells and blockquotes without changing neighbours", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [
        {
          type: "table",
          children: [{
            type: "tableRow",
            children: [
              { type: "tableCell", children: [paragraph("cell")] },
              { type: "tableCell", children: [paragraph("other")] },
            ],
          }],
        },
        { type: "blockquote", children: [paragraph("quote")] },
      ],
    };
    const tableState = stateFor(document, [0, 0, 0, 0, 0], 0, 4);
    const tableNext = applyTransaction(tableState, applyLink.execute(tableState, { href: "https://cell.test" }));
    const quoteState = stateFor(tableNext.document, [1, 0, 0], 0, 5);
    const next = applyTransaction(quoteState, applyLink.execute(quoteState, { href: "tel:+15551234567" }));

    expect((((next.document.children[0] as any).children[0].children[0].children[0].children[0]) as any).marks).toEqual([{ type: "link", href: "https://cell.test" }]);
    expect((((next.document.children[0] as any).children[0].children[1].children[0].children[0]) as any).marks).toBeUndefined();
    expect((((next.document.children[1] as any).children[0].children[0]) as any).marks).toEqual([{ type: "link", href: "tel:+15551234567" }]);
  });
});
