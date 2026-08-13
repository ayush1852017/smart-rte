import { describe, expect, it } from "vitest";
import {
  checklistPlugin,
  createSmartEditor,
  listPlugin,
  paragraph,
  type SmartEditorState,
} from "../legacy/index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("one"), paragraph("two")] },
  selection: {
    type: "text",
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [1, 0], offset: 3 },
  },
});

describe("checklist plugin", () => {
  it("requires and orders the list plugin", () => {
    expect(() => createSmartEditor({ state: state(), plugins: [checklistPlugin] }))
      .toThrow("requires missing plugin");
    const editor = createSmartEditor({
      state: state(),
      plugins: [checklistPlugin, listPlugin],
    });
    expect(editor.pluginIds).toEqual(["list", "checklist"]);
  });

  it("creates a checklist, records checked state, and toggles back to bullets", () => {
    const editor = createSmartEditor({
      state: state(),
      plugins: [listPlugin, checklistPlugin],
    });
    expect(editor.execute("checklist.toggle", { strikeCompleted: true })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      type: "list",
      style: "disc",
      checklist: true,
      strikeCompleted: true,
      children: [{ checked: false }, { checked: false }],
    });

    expect(editor.execute("checklist.set-checked", { path: [0, 1] })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ checked: false }, { checked: true }],
    });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ checked: false }, { checked: false }],
    });

    expect(editor.execute("checklist.toggle")).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      type: "list",
      style: "disc",
    });
    expect(editor.state.document.children[0]).not.toHaveProperty("checklist");
  });
});
