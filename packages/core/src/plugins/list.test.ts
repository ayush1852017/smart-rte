import { describe, expect, it } from "vitest";
import {
  createSmartEditor,
  listPlugin,
  paragraph,
  type SmartDocument,
  type SmartEditorState,
  type SmartListNode,
} from "../index.js";

const textSelection = (anchor: readonly number[], focus: readonly number[]) => ({
  type: "text" as const,
  anchor: { path: anchor, offset: 0 },
  focus: { path: focus, offset: 1 },
});

const editorFor = (document: SmartDocument, anchor: readonly number[], focus: readonly number[]) =>
  createSmartEditor({
    state: { document, selection: textSelection(anchor, focus) },
    plugins: [listPlugin],
  });

describe("list plugin", () => {
  it("is independently enableable", () => {
    const state: SmartEditorState = {
      document: { type: "doc", children: [paragraph("one")] },
      selection: textSelection([0, 0], [0, 0]),
    };
    expect(createSmartEditor({ state }).canExecute("list.toggle", { style: "decimal" })).toBe(false);
    expect(createSmartEditor({ state, plugins: [listPlugin] })
      .canExecute("list.toggle", { style: "decimal" })).toBe(true);
  });

  it("converts a selected block range and toggles the same list style off", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [paragraph("one"), paragraph("two"), paragraph("three")],
    };
    const editor = editorFor(document, [0, 0], [2, 0]);
    editor.execute("list.toggle", { style: "decimal" });
    expect(editor.state.document.children).toEqual([{
      type: "list",
      style: "decimal",
      children: [
        { type: "listItem", children: [paragraph("one")] },
        { type: "listItem", children: [paragraph("two")] },
        { type: "listItem", children: [paragraph("three")] },
      ],
    }]);

    editor.execute("list.toggle", { style: "decimal" });
    expect(editor.state.document).toEqual(document);
  });

  it("changes a selected list run without deleting nested descendants", () => {
    const nested: SmartListNode = {
      type: "list",
      style: "disc",
      children: [
        {
          type: "listItem",
          children: [
            paragraph("parent"),
            {
              type: "list",
              style: "circle",
              children: [
                { type: "listItem", children: [paragraph("child one")] },
                { type: "listItem", children: [paragraph("child two")] },
              ],
            },
          ],
        },
        { type: "listItem", children: [paragraph("sibling")] },
      ],
    };
    const editor = editorFor(
      { type: "doc", children: [paragraph("heading"), nested, paragraph("after")] },
      [1, 0, 0, 0],
      [1, 0, 1, 1, 0, 0],
    );

    editor.execute("list.toggle", { style: "decimal" });
    const result = editor.state.document.children[1] as SmartListNode;
    expect(result.style).toBe("decimal");
    expect(result.children[0].children[1]).toEqual(nested.children[0].children[1]);
    expect(result.children[1]).toEqual(nested.children[1]);
  });

  it("optionally assigns deterministic styles through the selected list hierarchy", () => {
    const list: SmartListNode = {
      type: "list",
      style: "disc",
      children: [{
        type: "listItem",
        children: [
          paragraph("parent"),
          {
            type: "list",
            style: "circle",
            children: [{
              type: "listItem",
              children: [
                paragraph("child"),
                {
                  type: "list",
                  style: "square",
                  children: [{ type: "listItem", children: [paragraph("grandchild")] }],
                },
              ],
            }],
          },
        ],
      }],
    };
    const editor = editorFor({ type: "doc", children: [list] }, [0, 0, 0, 0], [0, 0, 0, 0]);
    editor.execute("list.toggle", { style: "decimal", cascadeStyles: true });

    const outer = editor.state.document.children[0] as SmartListNode;
    const nested = outer.children[0].children[1] as SmartListNode;
    const deepest = nested.children[0].children[1] as SmartListNode;
    expect([outer.style, nested.style, deepest.style])
      .toEqual(["decimal", "lower-alpha", "lower-roman"]);
  });

  it("splits a list when only a middle item changes type", () => {
    const list: SmartListNode = {
      type: "list",
      style: "disc",
      children: ["one", "two", "three"].map((text) => ({
        type: "listItem",
        children: [paragraph(text)],
      })),
    };
    const editor = editorFor({ type: "doc", children: [list] }, [0, 1, 0, 0], [0, 1, 0, 0]);
    editor.execute("list.toggle", { style: "decimal", scope: "selected-items" });

    expect(editor.state.document.children.map((node) =>
      node.type === "list" ? [node.style, node.children.length] : node.type))
      .toEqual([["disc", 1], ["decimal", 1], ["disc", 1]]);
  });

  it("works inside a table cell without changing the table structure", () => {
    const document: SmartDocument = {
      type: "doc",
      children: [{
        type: "table",
        children: [{
          type: "tableRow",
          children: [{
            type: "tableCell",
            children: [paragraph("one"), paragraph("two")],
          }],
        }],
      }],
    };
    const editor = editorFor(document, [0, 0, 0, 0, 0], [0, 0, 0, 1, 0]);
    editor.execute("list.toggle", { style: "lower-alpha" });
    const table = editor.state.document.children[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.children[0].children[0].children).toMatchObject([{
      type: "list",
      style: "lower-alpha",
      children: [{ type: "listItem" }, { type: "listItem" }],
    }]);
  });

  it("undoes and redoes conversion as one transaction", () => {
    const document: SmartDocument = { type: "doc", children: [paragraph("one"), paragraph("two")] };
    const editor = editorFor(document, [0, 0], [1, 0]);
    editor.execute("list.toggle", { style: "disc" });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document).toEqual(document);
    expect(editor.redo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({ type: "list", style: "disc" });
  });

  it("indents and outdents a selected run without changing its content or style", () => {
    const list: SmartListNode = {
      type: "list",
      style: "lower-alpha",
      children: ["one", "two", "three"].map((text) => ({
        type: "listItem",
        children: [paragraph(text)],
      })),
    };
    const editor = editorFor(
      { type: "doc", children: [list] },
      [0, 1, 0, 0],
      [0, 2, 0, 0],
    );

    expect(editor.execute("list.indent")).toBe(true);
    const indented = editor.state.document.children[0] as SmartListNode;
    expect(indented.children).toHaveLength(1);
    expect(indented.children[0].children[1]).toMatchObject({
      type: "list",
      style: "lower-alpha",
      children: [
        { children: [paragraph("two")] },
        { children: [paragraph("three")] },
      ],
    });
    expect(editor.state.selection).toEqual(textSelection(
      [0, 0, 1, 0, 0, 0],
      [0, 0, 1, 1, 0, 0],
    ));

    editor.dispatch({
      id: "select-nested-items",
      source: "api",
      operations: [],
      selectionBefore: editor.state.selection,
      selectionAfter: textSelection([0, 0, 1, 0, 0, 0], [0, 0, 1, 1, 0, 0]),
      addToHistory: false,
      timestamp: 2,
    });
    expect(editor.execute("list.outdent")).toBe(true);
    expect(editor.state.document.children[0]).toEqual(list);
    expect(editor.state.selection).toEqual(textSelection(
      [0, 1, 0, 0],
      [0, 2, 0, 0],
    ));
  });

  it("disables invalid depth changes", () => {
    const list: SmartListNode = {
      type: "list",
      style: "disc",
      children: [{ type: "listItem", children: [paragraph("only")] }],
    };
    const editor = editorFor({ type: "doc", children: [list] }, [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(editor.canExecute("list.indent")).toBe(false);
    expect(editor.canExecute("list.outdent")).toBe(false);
  });
});
