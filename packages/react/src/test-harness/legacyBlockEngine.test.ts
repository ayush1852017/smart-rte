// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { legacyBlockToolIds, runLegacyBlockTool, type LegacyBlockInput, type LegacyBlockToolId } from "./legacyBlockEngine.js";

const inputs: Record<LegacyBlockToolId, LegacyBlockInput> = {
  setType: { parentPath: [], blockIndexes: [0], type: "heading", level: 2 },
  blockquote: { parentPath: [], blockIndexes: [0] },
  codeBlock: { parentPath: [], blockIndexes: [0] },
  alignment: { paths: [[0]], alignment: "center" },
  indent: { parentPath: [], blockIndexes: [0], direction: "indent" },
  move: { parentPath: [], blockIndexes: [1], direction: "up" },
};

const selectFirstParagraph = (root: HTMLElement) => {
  const text = root.querySelector("p")!.firstChild!;
  root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, text.textContent!.length);
};

describe("Phase 5 retained legacy block engine", () => {
  it("is frozen before deletion and executes every retained block tool", () => {
    expect(legacyBlockToolIds).toEqual(["setType", "blockquote", "codeBlock", "alignment", "indent", "move"]);
    for (const tool of legacyBlockToolIds) {
      const root = document.createElement("div");
      root.innerHTML = "<p>one</p><p>two</p>";
      document.body.append(root);
      selectFirstParagraph(root);
      expect(runLegacyBlockTool(root, tool, inputs[tool]), tool).not.toBeNull();
      root.remove();
    }
  });
});
