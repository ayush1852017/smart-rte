import { describe, expect, it } from "vitest";
import { createSmartEditor, movePlugin, paragraph, type SmartEditorState } from "../index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: ["A", "B", "C", "D"].map(paragraph) },
  selection: { type: "text", anchor: { path: [1, 0], offset: 0 }, focus: { path: [2, 0], offset: 1 } },
});

const texts = (editor: ReturnType<typeof createSmartEditor>) =>
  editor.state.document.children.map((block) =>
    block.type === "paragraph" && block.children[0].type === "text" ? block.children[0].text : "");

describe("move plugin", () => {
  it("moves a contiguous sibling range as one unit and supports undo", () => {
    const editor = createSmartEditor({ state: state(), plugins: [movePlugin] });
    expect(editor.execute("block.move", { parentPath: [], blockIndexes: [1, 2], direction: "up" })).toBe(true);
    expect(texts(editor)).toEqual(["B", "C", "A", "D"]);
    expect(editor.undo()).toBe(true);
    expect(texts(editor)).toEqual(["A", "B", "C", "D"]);
    expect(editor.execute("block.move", { parentPath: [], blockIndexes: [1, 2], direction: "down" })).toBe(true);
    expect(texts(editor)).toEqual(["A", "D", "B", "C"]);
  });

  it("rejects disconnected ranges and document boundaries", () => {
    const editor = createSmartEditor({ state: state(), plugins: [movePlugin] });
    expect(editor.canExecute("block.move", { parentPath: [], blockIndexes: [0], direction: "up" })).toBe(false);
    expect(editor.canExecute("block.move", { parentPath: [], blockIndexes: [1, 3], direction: "down" })).toBe(false);
    expect(editor.canExecute("block.move", { parentPath: [], blockIndexes: [3], direction: "down" })).toBe(false);
  });

  it("changes indentation without exceeding model bounds", () => {
    const editor = createSmartEditor({ state: state(), plugins: [movePlugin] });
    expect(editor.execute("block.indent", { parentPath: [], blockIndexes: [1, 2], direction: "indent" })).toBe(true);
    expect(editor.state.document.children.map((block) => block.indent || 0)).toEqual([0, 1, 1, 0]);
    expect(editor.execute("block.indent", { parentPath: [], blockIndexes: [1, 2], direction: "outdent" })).toBe(true);
    expect(editor.state.document.children.map((block) => block.indent || 0)).toEqual([0, 0, 0, 0]);
    expect(editor.canExecute("block.indent", { parentPath: [], blockIndexes: [1, 2], direction: "outdent" })).toBe(false);
  });
});
