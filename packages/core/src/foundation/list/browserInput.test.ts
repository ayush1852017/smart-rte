// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createFoundationEditor,
  createInputPipeline,
  createSubtreeRenderer,
  type SmartDocument,
  type SmartElementNode,
  type SmartSelection,
} from "../index.js";

const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const item = (id: string, text: string, extra: SmartElementNode[] = []): SmartElementNode => ({ type: "list_item", id, children: [p(`${id}-p`, text), ...extra] });
const list = (id: string, items: SmartElementNode[]): SmartElementNode => ({ type: "list", id, attrs: { style: "disc" }, children: items });
const model = (): SmartDocument => ({ type: "doc", id: "doc", children: [list("root", [
  item("first", "F", [list("nested", [item("deep", "D")])]),
  item("second", "S"),
  item("third", "T"),
])] });
const caret = (path: number[], offset: number): SmartSelection => ({ type: "text", anchor: { path, offset }, head: { path, offset } });

describe("Phase 3 browser-input routing", () => {
  it("routes cross-parent Backspace through one structural history step", () => {
    const before = model();
    const selection = caret([0, 1, 0], 0);
    const editor = createFoundationEditor({ document: before, selection });
    const initial = structuredClone(editor.document);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(JSON.stringify(editor.document)).not.toContain('"id":"second"');
    expect(renderer.mapping.nodeToDom("deep-p")?.textContent).toBe("DS");
    expect(editor.history.undo).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(editor.document).toEqual(initial);
    expect(editor.selection).toEqual(selection);
    expect(editor.redo()).toBe(true);
    expect(JSON.stringify(editor.document)).not.toContain('"id":"second"');
    pipeline.destroy();
  });

  it("keeps consecutive Tab intents as separate undo steps and preserves focus", () => {
    const editor = createFoundationEditor({ document: model(), selection: caret([0, 2, 0], 0) });
    const initial = structuredClone(editor.document);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    root.focus();
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }));
    expect(editor.history.undo).toHaveLength(1);
    expect(root.querySelector('[data-smart-ui="list-level-announcement"]')?.textContent).toBe("List level 2");
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true }));
    expect(editor.history.undo).toHaveLength(2);
    expect(root.querySelector('[data-smart-ui="list-level-announcement"]')?.textContent).toBe("List level 1");
    expect(document.activeElement).toBe(root);
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.document).toEqual(initial);
    pipeline.destroy();
  });

  it("renders real nested list semantics and checklist accessibility state", () => {
    const checkable: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "list", id: "checks", attrs: { checkable: true, style: "disc" }, children: [
        { type: "list_item", id: "check", attrs: { checked: true }, children: [p("check-p", "done")] },
      ],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(checkable, caret([0, 0, 0], 0));
    expect(root.querySelector("ul > li > p")?.textContent).toBe("done");
    expect(root.querySelector("li")?.getAttribute("role")).toBeNull();
    expect(root.querySelector('[data-smart-ui="check-control"]')?.getAttribute("role")).toBe("checkbox");
    expect(root.querySelector('[data-smart-ui="check-control"]')?.getAttribute("aria-checked")).toBe("true");
  });
});
