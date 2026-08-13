import { describe, expect, it } from "vitest";
import {
  basicFormattingPlugin,
  createSmartEditor,
  paragraph,
  type SmartEditorState,
} from "../legacy/index.js";

const selectedTextState = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("hello")] },
  selection: {
    type: "text",
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 5 },
  },
});

describe("basic formatting plugin", () => {
  it("exposes formatting only when the plugin is enabled", () => {
    const withoutPlugin = createSmartEditor({ state: selectedTextState() });
    const withPlugin = createSmartEditor({
      state: selectedTextState(),
      plugins: [basicFormattingPlugin],
    });

    expect(withoutPlugin.canExecute("toggle-bold")).toBe(false);
    expect(withPlugin.canExecute("toggle-bold")).toBe(true);
  });

  it("executes marks through the editor transaction and history runtime", () => {
    const editor = createSmartEditor({
      state: selectedTextState(),
      plugins: [basicFormattingPlugin],
    });

    expect(editor.execute("toggle-bold")).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "hello", marks: [{ type: "bold" }] }],
    });
    expect(editor.undo()).toBe(true);
    expect(editor.state).toEqual(selectedTextState());
    expect(editor.redo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ marks: [{ type: "bold" }] }],
    });
  });

  it("enforces mutually exclusive superscript and subscript marks", () => {
    const editor = createSmartEditor({
      state: selectedTextState(),
      plugins: [basicFormattingPlugin],
    });

    editor.execute("toggle-superscript");
    editor.execute("toggle-subscript");
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ marks: [{ type: "subscript" }] }],
    });
  });

  it("supports value-carrying color and font-size commands", () => {
    const editor = createSmartEditor({
      state: selectedTextState(),
      plugins: [basicFormattingPlugin],
    });

    editor.execute("apply-text-color", "#123456");
    editor.execute("apply-background-color", "#abcdef");
    editor.execute("apply-font-size", 18);
    editor.execute("apply-font-family", "Inter");
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{
        marks: [
          { type: "textColor", value: "#123456" },
          { type: "backgroundColor", value: "#abcdef" },
          { type: "fontSize", valuePx: 18 },
          { type: "fontFamily", value: "Inter" },
        ],
      }],
    });
  });
});
