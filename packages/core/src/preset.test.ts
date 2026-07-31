import { describe, expect, it } from "vitest";
import {
  createCorePlugins,
  createSmartEditor,
  paragraph,
  type SmartEditorState,
} from "./index.js";

const state: SmartEditorState = {
  document: { type: "doc", children: [paragraph("text")] },
  selection: {
    type: "text",
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 4 },
  },
};

describe("core plugin preset", () => {
  it("provides every standard feature in dependency-safe order", () => {
    const editor = createSmartEditor({ state, plugins: createCorePlugins() });
    expect(editor.pluginIds).toEqual([
      "basic-formatting",
      "block-type",
      "alignment",
      "list",
      "checklist",
      "blockquote",
      "code-block",
      "table",
      "media",
      "formula",
      "move",
    ]);
  });

  it("allows independent features to be disabled", () => {
    const editor = createSmartEditor({
      state,
      plugins: createCorePlugins({ formula: false, media: false, table: false }),
    });
    expect(editor.pluginIds).not.toContain("formula");
    expect(editor.pluginIds).not.toContain("media");
    expect(editor.pluginIds).not.toContain("table");
    expect(editor.canExecute("formula.insert", { value: "x" })).toBe(false);
    expect(editor.canExecute("toggle-bold")).toBe(true);
  });

  it("removes checklist automatically when its list dependency is disabled", () => {
    const editor = createSmartEditor({
      state,
      plugins: createCorePlugins({ list: false }),
    });
    expect(editor.pluginIds).not.toContain("list");
    expect(editor.pluginIds).not.toContain("checklist");
  });
});
