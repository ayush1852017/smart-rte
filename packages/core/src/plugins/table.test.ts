import { describe, expect, it } from "vitest";
import { createSmartEditor, paragraph, tablePlugin, type SmartEditorState } from "../legacy/index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("before")] },
  selection: { type: "node", path: [0] },
});

describe("table plugin", () => {
  it("inserts a header table and edits rows and columns transactionally", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    expect(editor.execute("table.insert", {
      path: [1], rows: 2, columns: 2, headerRow: true,
    })).toBe(true);
    expect(editor.state.document.children[1]).toMatchObject({
      type: "table",
      children: [
        { children: [{ type: "tableHeaderCell" }, { type: "tableHeaderCell" }] },
        { children: [{ type: "tableCell" }, { type: "tableCell" }] },
      ],
    });
    expect(editor.execute("table.row.add", { tablePath: [1], index: 1 })).toBe(true);
    expect((editor.state.document.children[1] as any).children).toHaveLength(3);
    expect(editor.execute("table.column.add", { tablePath: [1], index: 1 })).toBe(true);
    expect((editor.state.document.children[1] as any).children[0].children).toHaveLength(3);
    expect(editor.execute("table.column.remove", { tablePath: [1], index: 0 })).toBe(true);
    expect((editor.state.document.children[1] as any).children[0].children).toHaveLength(2);
    expect(editor.execute("table.row.remove", { tablePath: [1], index: 1 })).toBe(true);
    expect((editor.state.document.children[1] as any).children).toHaveLength(2);
  });

  it("prevents deleting the final row or column and supports undo", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 1, columns: 1 });
    expect(editor.canExecute("table.row.remove", { tablePath: [1], index: 0 })).toBe(false);
    expect(editor.canExecute("table.column.remove", { tablePath: [1], index: 0 })).toBe(false);
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children).toEqual([paragraph("before")]);
  });

  it("removes a table transactionally and restores it with undo", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    expect(editor.execute("table.remove", { tablePath: [1] })).toBe(true);
    expect(editor.state.document.children).toEqual([paragraph("before")]);
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[1]).toMatchObject({ type: "table" });
  });

  it("toggles cell, row, and logical column headers through merged cells", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });

    expect(editor.execute("table.header.cell.toggle", {
      tablePath: [1], row: 0, column: 0,
    })).toBe(true);
    let table = editor.state.document.children[1] as any;
    expect(table.children[0].children.map((cell: any) => cell.type))
      .toEqual(["tableHeaderCell", "tableCell"]);

    expect(editor.execute("table.header.row.toggle", {
      tablePath: [1], row: 0, column: 1,
    })).toBe(true);
    table = editor.state.document.children[1] as any;
    expect(table.children[0].children.map((cell: any) => cell.type))
      .toEqual(["tableHeaderCell", "tableHeaderCell"]);

    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 0 },
    });
    expect(editor.execute("table.header.column.toggle", {
      tablePath: [1], row: 1, column: 0,
    })).toBe(true);
    table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0]).toMatchObject({
      type: "tableCell",
      rowspan: 2,
    });
    expect(table.children[0].children[1].type).toBe("tableHeaderCell");
    expect(table.children[1].children[0].type).toBe("tableCell");
  });

  it("styles a logical cell range without breaking merged cells", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 0 },
    });
    expect(editor.execute("table.cell.style.set", {
      tablePath: [1],
      start: { row: 1, column: 0 },
      end: { row: 1, column: 1 },
      backgroundColor: "#123456",
      textColor: "#ffffff",
    })).toBe(true);
    const table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0]).toMatchObject({
      rowspan: 2,
      backgroundColor: "#123456",
      textColor: "#ffffff",
    });
    expect(table.children[1].children[0]).toMatchObject({
      backgroundColor: "#123456",
      textColor: "#ffffff",
    });
    expect(table.children[0].children[1]).not.toHaveProperty("backgroundColor");
  });

  it("persists logical column widths and row heights", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    expect(editor.execute("table.column.width.set", {
      tablePath: [1], index: 1, widthPx: 180,
    })).toBe(true);
    expect(editor.execute("table.row.height.set", {
      tablePath: [1], index: 0, heightPx: 48,
    })).toBe(true);
    let table = editor.state.document.children[1] as any;
    expect(table.columnWidths).toEqual([60, 180]);
    expect(table.children[0].heightPx).toBe(48);

    editor.execute("table.column.add", { tablePath: [1], index: 1 });
    table = editor.state.document.children[1] as any;
    expect(table.columnWidths).toEqual([60, 60, 180]);
    editor.execute("table.column.remove", { tablePath: [1], index: 0 });
    table = editor.state.document.children[1] as any;
    expect(table.columnWidths).toEqual([60, 180]);
  });

  it("toggles borders across a logical range including merged cells", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 0 },
    });
    expect(editor.execute("table.cell.border.toggle", {
      tablePath: [1],
      start: { row: 1, column: 0 },
      end: { row: 1, column: 1 },
    })).toBe(true);
    let table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0].border).toBe("1px solid #d1d5db");
    expect(table.children[1].children[0].border).toBe("1px solid #d1d5db");
    expect(table.children[0].children[1].border).toBeUndefined();

    editor.execute("table.cell.border.toggle", {
      tablePath: [1],
      start: { row: 1, column: 0 },
      end: { row: 1, column: 1 },
    });
    table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0].border).toBe("none");
    expect(table.children[1].children[0].border).toBe("none");
  });

  it("merges a rectangular region without losing content and splits it again", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    const table = editor.state.document.children[1] as any;
    table.children[0].children[0].children = [paragraph("a")];
    table.children[0].children[1].children = [paragraph("b")];
    table.children[1].children[0].children = [paragraph("c")];
    table.children[1].children[1].children = [paragraph("d")];

    expect(editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 1 },
    })).toBe(true);
    expect((editor.state.document.children[1] as any).children).toMatchObject([
      {
        children: [{
          colspan: 2,
          rowspan: 2,
          children: [
            { children: [{ text: "a" }] },
            { children: [{ text: "b" }] },
            { children: [{ text: "c" }] },
            { children: [{ text: "d" }] },
          ],
        }],
      },
      { children: [] },
    ]);
    expect(editor.undo()).toBe(true);
    expect((editor.state.document.children[1] as any).children.map((row: any) => row.children.length))
      .toEqual([2, 2]);
    expect(editor.redo()).toBe(true);
    expect(editor.execute("table.cell.split", {
      tablePath: [1], row: 1, column: 1,
    })).toBe(true);
    const split = editor.state.document.children[1] as any;
    expect(split.children.map((row: any) => row.children.length)).toEqual([2, 2]);
    expect(split.children[0].children[0].children).toHaveLength(4);
    expect(split.children[0].children[0]).not.toHaveProperty("rowspan");
    expect(split.children[0].children[0]).not.toHaveProperty("colspan");
  });

  it("rejects a selection that cuts through an existing merged cell", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 0 },
    });
    expect(editor.canExecute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 0, column: 1 },
    })).toBe(false);
  });

  it("adds and removes rows through merged cells without invalidating the grid", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2 });
    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 1, column: 1 },
    });

    expect(editor.execute("table.row.add", { tablePath: [1], index: 1 })).toBe(true);
    let table = editor.state.document.children[1] as any;
    expect(table.children).toHaveLength(3);
    expect(table.children[0].children[0]).toMatchObject({ rowspan: 3, colspan: 2 });
    expect(table.children[1].children).toHaveLength(0);

    expect(editor.execute("table.row.remove", { tablePath: [1], index: 0 })).toBe(true);
    table = editor.state.document.children[1] as any;
    expect(table.children).toHaveLength(2);
    expect(table.children[0].children[0]).toMatchObject({ rowspan: 2, colspan: 2 });
    expect(table.children[0].children[0].children).toHaveLength(4);
  });

  it("adds and removes logical columns through merged cells", () => {
    const editor = createSmartEditor({ state: state(), plugins: [tablePlugin] });
    editor.execute("table.insert", { path: [1], rows: 2, columns: 2, headerRow: true });
    editor.execute("table.cell.merge", {
      tablePath: [1],
      start: { row: 0, column: 0 },
      end: { row: 0, column: 1 },
    });

    expect(editor.execute("table.column.add", { tablePath: [1], index: 1 })).toBe(true);
    let table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0]).toMatchObject({
      type: "tableHeaderCell",
      colspan: 3,
    });
    expect(table.children[1].children).toHaveLength(3);

    expect(editor.execute("table.column.remove", { tablePath: [1], index: 1 })).toBe(true);
    table = editor.state.document.children[1] as any;
    expect(table.children[0].children[0]).toMatchObject({ colspan: 2 });
    expect(table.children[1].children).toHaveLength(2);
  });
});
