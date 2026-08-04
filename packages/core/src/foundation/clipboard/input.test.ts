// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FoundationEditor } from "../editor.js";
import { createSubtreeRenderer } from "../surface/renderer.js";
import { FoundationInputPipeline } from "../surface/input.js";
import type { SmartSelection } from "../types.js";

class FakeTransfer {
  private values = new Map<string, string>();
  files = [] as unknown as FileList;
  effectAllowed = "uninitialized";
  get types() { return [...this.values.keys()]; }
  getData(type: string) { return this.values.get(type) || ""; }
  setData(type: string, value: string) { this.values.set(type, value); }
}

const select = (from: number, to = from): SmartSelection => ({ type: "text", anchor: { path: [0], offset: from }, head: { path: [0], offset: to } });
const text = (editor: FoundationEditor) => {
  const block = editor.document.children[0];
  return block.type === "text" ? block.text : (block.children || []).map((node) => node.type === "text" ? node.text : "").join("");
};

describe("canonical clipboard browser entry points", () => {
  it("pastes over a selection as one transaction and one undo step", () => {
    const root = document.createElement("div"); document.body.append(root);
    const editor = new FoundationEditor({ document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] }] }, selection: select(0, 5) });
    const pipeline = new FoundationInputPipeline(editor, createSubtreeRenderer(root), root);
    const transfer = new FakeTransfer(); transfer.setData("text/plain", "world");
    let prevented = false;
    pipeline.handlePaste({ clipboardData: transfer, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent);
    expect(prevented).toBe(true);
    expect(text(editor)).toBe("world");
    expect(editor.history.undo).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(text(editor)).toBe("hello");
    pipeline.destroy();
  });

  it("copies three representations with clean HTML and cuts atomically", () => {
    const root = document.createElement("div"); document.body.append(root);
    const editor = new FoundationEditor({ document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] }] }, selection: select(0, 5) });
    const pipeline = new FoundationInputPipeline(editor, createSubtreeRenderer(root), root);
    const transfer = new FakeTransfer();
    pipeline.handleCopy({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    expect(transfer.types.sort()).toEqual(["application/x-smart-rte+json", "text/html", "text/plain"].sort());
    expect(transfer.getData("text/html")).not.toMatch(/data-smart-id|data-smart-ui/);
    pipeline.handleCut({ clipboardData: transfer, preventDefault: () => undefined } as unknown as ClipboardEvent);
    expect(text(editor)).toBe("");
    expect(editor.history.undo).toHaveLength(1);
    expect(editor.history.undo[0].forward.metadata.source).toBe("cut");
    pipeline.destroy();
  });
});
