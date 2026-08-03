// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  SMART_UI_ATTRIBUTE,
  renderDocumentNaively,
  type SmartDocument,
} from "smartrte-core/foundation";

  const model: SmartDocument = {
  type: "doc",
  id: "doc",
  children: [
    {
      type: "paragraph",
      id: "p1",
      children: [
        { type: "text", text: "hello" },
        {
          type: "unknown",
          id: "atom",
          attrs: { originalType: "mention", originalGroup: "inline", raw: { type: "mention", value: "Ada" }, editable: false },
        },
        { type: "text", text: "world" },
      ],
    },
    { type: "paragraph", id: "p2", children: [] },
  ],
};

describe("Phase 1 ModelDomMapping", () => {
  it("round-trips text offsets, block boundaries, and atomic positions", () => {
    const root = document.createElement("div");
    const mapping = renderDocumentNaively(root, model);
    for (const offset of [0, 2, 5, 6, 8, 11]) {
      const position = { path: [0], offset };
      const dom = mapping.posToDom(position);
      expect(dom).not.toBeNull();
      expect(mapping.domToPos(dom!.node, dom!.offset)).toEqual(position);
    }
    for (const offset of [0, 1, 2]) {
      const position = { path: [], offset };
      const dom = mapping.posToDom(position);
      expect(dom).not.toBeNull();
      expect(mapping.domToPos(dom!.node, dom!.offset)).toEqual(position);
    }
    expect(mapping.nodeToDom("atom")?.contentEditable).toBe("false");
    expect(mapping.domToNode(mapping.nodeToDom("p1")!)).toMatchObject({ nodeId: "p1" });
  });

  it("skips editor UI nodes and can rebuild from DOM plus model", () => {
    const root = document.createElement("div");
    const mapping = renderDocumentNaively(root, model);
    const ui = document.createElement("button");
    ui.setAttribute(SMART_UI_ATTRIBUTE, "toolbar");
    root.prepend(ui);
    expect(mapping.isEditorUiNode(ui)).toBe(true);
    expect(mapping.domToNode(ui)).toBeNull();
    mapping.rebuild(root, model);
    expect(mapping.nodeToDom("p2")).not.toBeNull();
  });
});
