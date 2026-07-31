import { describe, expect, it } from "vitest";
import { createSmartEditor, formulaPlugin, paragraph, type SmartEditorState } from "../index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("abcd")] },
  selection: { type: "text", anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 2 } },
});

describe("formula plugin", () => {
  it("inserts an inline formula at a caret and participates in history", () => {
    const editor = createSmartEditor({ state: state(), plugins: [formulaPlugin] });
    expect(editor.execute("formula.insert", { value: "x^2", displayText: "x²" })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [
        { text: "ab" },
        { type: "formula", value: "x^2", displayText: "x²" },
        { text: "cd" },
      ],
    });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("abcd"));
    expect(editor.redo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "ab" }, { type: "formula", value: "x^2" }, { text: "cd" }],
    });
  });

  it("rejects an empty formula and non-collapsed selections", () => {
    const editor = createSmartEditor({ state: state(), plugins: [formulaPlugin] });
    expect(editor.canExecute("formula.insert", { value: " " })).toBe(false);
    editor.dispatch({
      id: "selection",
      source: "api",
      operations: [],
      selectionBefore: editor.state.selection,
      selectionAfter: {
        type: "text",
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 2 },
      },
      addToHistory: false,
      timestamp: 1,
    });
    expect(editor.canExecute("formula.insert", { value: "x" })).toBe(false);
  });

  it("deletes a formula atom without joining its surrounding text implicitly", () => {
    const editor = createSmartEditor({ state: state(), plugins: [formulaPlugin] });
    editor.execute("formula.insert", { value: "x^2" });
    expect(editor.execute("formula.delete", { path: [0, 1] })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "ab" }, { text: "cd" }],
    });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "ab" }, { type: "formula", value: "x^2" }, { text: "cd" }],
    });
  });
});
