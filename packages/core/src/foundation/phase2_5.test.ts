// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyOperation,
  applyOperations,
  createFoundationEditor,
  createInputPipeline,
  createSchema,
  createScopeIndex,
  createSubtreeRenderer,
  foundationSchema,
  resolveScope,
  type SmartDocument,
  type SmartOperation,
  type SmartSchema,
  type SmartSelection,
} from "./index.js";

const caret = (offset: number, path = [0]): SmartSelection => ({
  type: "text", anchor: { path, offset }, head: { path, offset },
});
const paragraph = (id: string, text: string) => ({ type: "paragraph", id, children: text ? [{ type: "text" as const, text }] : [] });
const documentOf = (...texts: string[]): SmartDocument => ({ type: "doc", id: "doc", children: texts.map((text, index) => paragraph(`p${index}`, text)) });

describe("Phase 2.5 contract amendments", () => {
  it("resolves explicit semanticRole and conventional type fallback identically", () => {
    const roleSchema = createSchema({
      version: 25,
      nodes: [
        { type: "doc", group: "document", content: "block+" },
        { type: "paragraph", group: "block", content: "inline*" },
        { type: "text", group: "inline" },
        { type: "collection", semanticRole: "list", group: "block", content: "entry+" },
        { type: "entry", semanticRole: "list-item", group: "block", content: "paragraph" },
      ],
    });
    const roleDocument: SmartDocument = { type: "doc", id: "doc", children: [{ type: "collection", id: "list", children: [
      { type: "entry", id: "item", children: [paragraph("p", "x")] },
    ] }] };
    const explicit = resolveScope(roleDocument, caret(0, [0, 0, 0]), { want: "list-selection" }, roleSchema);
    const fallbackDocument: SmartDocument = { type: "doc", id: "doc", children: [{ type: "list", id: "list", children: [
      { type: "list_item", id: "item", children: [paragraph("p", "x")] },
    ] }] };
    const fallback = resolveScope(fallbackDocument, caret(0, [0, 0, 0]), { want: "list-selection" }, foundationSchema);
    expect(explicit).toMatchObject({ kind: "list-selection", listId: "list", items: [{ itemId: "item", depth: 0 }] });
    expect(JSON.parse(JSON.stringify(explicit))).toEqual(JSON.parse(JSON.stringify(fallback)));
  });
});

describe("Phase 2.5 persistent apply", () => {
  it("preserves every untouched subtree reference", () => {
    const before = documentOf(...Array.from({ length: 100 }, (_, index) => `block-${index}`));
    const after = applyOperation(before, { type: "insertText", pos: { path: [50], offset: 2 }, text: "X" });
    expect(after).not.toBe(before);
    expect(after.children[50]).not.toBe(before.children[50]);
    before.children.forEach((node, index) => {
      if (index !== 50) expect(after.children[index]).toBe(node);
    });
  });

  it("preserves untouched references across 1,000 randomized edits (seed 0xC025CAFE)", () => {
    let state = 0xC025CAFE;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    let model = documentOf(...Array.from({ length: 64 }, (_, index) => `block-${index}`));
    for (let run = 0; run < 1_000; run += 1) {
      const block = Math.floor(random() * model.children.length);
      const owner = model.children[block];
      const length = owner.type === "text" ? 0 : (owner.children?.[0]?.type === "text" ? owner.children[0].text.length : 0);
      const offset = Math.floor(random() * (length + 1));
      const after = applyOperation(model, { type: "insertText", pos: { path: [block], offset }, text: "x" });
      model.children.forEach((node, index) => {
        if (index !== block) expect(after.children[index]).toBe(node);
      });
      expect(after.children[block]).not.toBe(owner);
      model = after;
    }
  });

  it("applies overlapping multi-op paths in one copy-on-write batch", () => {
    const before = documentOf("x", "untouched");
    const operations: SmartOperation[] = [
      { type: "insertText", pos: { path: [0], offset: 1 }, text: "a" },
      { type: "insertText", pos: { path: [0], offset: 2 }, text: "b" },
      { type: "insertText", pos: { path: [0], offset: 3 }, text: "c" },
    ];
    const after = applyOperations(before, operations);
    expect(after.children[1]).toBe(before.children[1]);
    expect(after.children[0]).toEqual(paragraph("p0", "xabc"));
  });
});

describe("Phase 2.5 scope cache and PositionLookup", () => {
  it("keeps cold and warm results byte-identical across 1,000 randomized edits (seed 0x25CAFE)", () => {
    let state = 0x25CAFE;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    let model = documentOf(...Array.from({ length: 40 }, (_, index) => `block-${index}`));
    const cache = createScopeIndex();
    for (let run = 0; run < 1_000; run += 1) {
      const block = Math.floor(random() * 40);
      const owner = model.children[block];
      const length = owner.type === "text" ? 0 : (owner.children?.[0]?.type === "text" ? owner.children[0].text.length : 0);
      const offset = Math.floor(random() * (length + 1));
      const selection = caret(offset, [block]);
      const request = run % 2 ? { want: "describe" as const } : { want: "block-range" as const };
      const cold = resolveScope(model, selection, request, foundationSchema);
      const firstWarm = cache.resolve(model, selection, request, foundationSchema);
      const secondWarm = cache.resolve(model, selection, request, foundationSchema);
      expect(JSON.stringify(firstWarm)).toBe(JSON.stringify(cold));
      expect(JSON.stringify(secondWarm)).toBe(JSON.stringify(cold));
      model = applyOperation(model, { type: "insertText", pos: { path: [block], offset }, text: "x" });
    }
    expect(cache.liveNodeCount).toBe(41);
  });

  it("provides one shared ID-to-position lookup", () => {
    const model = documentOf("one", "two");
    const lookup = createScopeIndex().positions(model, foundationSchema);
    expect(lookup.exists("p1")).toBe(true);
    expect(lookup.positionOf("p1")).toMatchObject({ kind: "structural", pos: { path: [], offset: 1 } });
    expect(lookup.rangeOf("p1")).toEqual({ from: { path: [], offset: 1 }, to: { path: [], offset: 2 } });
    expect(lookup.contentRangeOf("p1")).toEqual({ from: { path: [1], offset: 0 }, to: { path: [1], offset: 3 } });
    expect(lookup.positionOf("retired")).toBeNull();
  });

  it("does not retain removed nodes in the editor-local index", () => {
    const cache = createScopeIndex();
    const before = documentOf("one", "two");
    cache.positions(before, foundationSchema);
    expect(cache.liveNodeCount).toBe(3);
    const after = applyOperation(before, {
      type: "removeNode",
      pos: { path: [], offset: 1 },
      node: before.children[1],
    });
    const lookup = cache.positions(after, foundationSchema);
    expect(cache.liveNodeCount).toBe(2);
    expect(lookup.exists("p1")).toBe(false);
  });
});

describe("Phase 2.5 renderer and input pipeline", () => {
  it("retains unchanged DOM identity and reverse selection direction", () => {
    const root = document.createElement("div");
    const ui = document.createElement("button");
    ui.setAttribute("data-smart-ui", "test-overlay");
    root.appendChild(ui);
    document.body.appendChild(root);
    const before = documentOf("one", "two");
    const renderer = createSubtreeRenderer(root);
    renderer.render(before, { type: "text", anchor: { path: [1], offset: 2 }, head: { path: [0], offset: 1 } });
    const second = renderer.mapping.nodeToDom("p1");
    const secondText = second?.firstChild;
    const after = applyOperation(before, { type: "insertText", pos: { path: [0], offset: 1 }, text: "X" });
    renderer.render(after, { type: "text", anchor: { path: [1], offset: 2 }, head: { path: [0], offset: 2 } });
    expect(renderer.mapping.nodeToDom("p1")).toBe(second);
    expect(renderer.mapping.nodeToDom("p1")?.firstChild).toBe(secondText);
    expect(root.contains(ui)).toBe(true);
    expect(document.getSelection()).toMatchObject({ anchorNode: secondText, anchorOffset: 2, focusOffset: 2 });
  });

  it("performs zero writes to the composing owner", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const before = documentOf("a", "stable");
    const renderer = createSubtreeRenderer(root);
    renderer.render(before, caret(1));
    renderer.beginComposition("p0");
    renderer.resetWriteCounters();
    const text = renderer.mapping.nodeToDom("p0")?.firstChild;
    if (text) text.nodeValue = "aन";
    const after = applyOperation(before, { type: "insertText", pos: { path: [0], offset: 1 }, text: "न" });
    renderer.render(after, caret(2));
    expect(renderer.composingDomWriteCount).toBe(0);
    expect(renderer.mapping.nodeToDom("p1")?.textContent).toBe("stable");
  });

  it("reconciles composition by marked tokens without flattening sibling runs", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const marked: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "paragraph", id: "p0", children: [
        { type: "text", text: "ab", marks: [{ type: "bold" }] },
        { type: "text", text: "cd", marks: [{ type: "italic" }] },
      ],
    }] };
    const editor = createFoundationEditor({ document: marked, selection: caret(1) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    pipeline.handleCompositionStart(new CompositionEvent("compositionstart", { data: "" }));
    const owner = renderer.mapping.nodeToDom("p0");
    const boldText = owner?.querySelector('[data-smart-mark="bold"]')?.firstChild;
    if (boldText) boldText.nodeValue = "aनb";
    const native = document.getSelection();
    if (boldText && native) native.setBaseAndExtent(boldText, 2, boldText, 2);
    renderer.resetWriteCounters();
    pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "न" }));
    expect(editor.document.children[0].children).toEqual([
      { type: "text", text: "aनb", marks: [{ type: "bold" }] },
      { type: "text", text: "cd", marks: [{ type: "italic" }] },
    ]);
    expect(renderer.composingDomWriteCount).toBe(0);
    pipeline.destroy();
  });

  it("routes text, deletion, paragraph splitting, history, composition, and unsupported input", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: documentOf("ab"), selection: caret(2) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string, data: string | null = null) => {
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data });
      root.dispatchEvent(event);
      return event;
    };
    expect(beforeInput("insertText", "c").defaultPrevented).toBe(true);
    expect(editor.document.children[0]).toEqual(paragraph("p0", "abc"));
    beforeInput("deleteContentBackward");
    expect(editor.document.children[0]).toEqual(paragraph("p0", "ab"));
    beforeInput("insertParagraph");
    expect(editor.document.children).toHaveLength(2);
    expect(editor.selection.head).toEqual({ path: [1], offset: 0 });
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }));
    expect(editor.document.children).toHaveLength(1);

    pipeline.handleCompositionStart(new CompositionEvent("compositionstart", { data: "" }));
    const text = renderer.mapping.nodeToDom("p0")?.firstChild;
    if (text) text.nodeValue = "abन";
    const native = document.getSelection();
    if (text && native) native.setBaseAndExtent(text, 3, text, 3);
    renderer.resetWriteCounters();
    pipeline.handleCompositionEnd(new CompositionEvent("compositionend", { data: "न" }));
    expect(editor.document.children[0]).toEqual(paragraph("p0", "abन"));
    expect(renderer.composingDomWriteCount).toBe(0);

    expect(beforeInput("formatBold").defaultPrevented).toBe(true);
    expect(pipeline.unhandledInputTypes).not.toContain("formatBold");
    expect(editor.storedMarks).toEqual([{ type: "bold" }]);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    root.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    pipeline.destroy();
  });

  it("routes code-block Enter, Shift+Enter, Tab, and Ctrl/Cmd+Enter through canonical operations", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const code: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "code_block", id: "code", attrs: { language: "ts" }, children: [{ type: "text", text: "ab" }],
    }] };
    const editor = createFoundationEditor({ document: code, selection: caret(1) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const dispatchKey = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
      root.dispatchEvent(event);
      return event;
    };
    const paragraphInput = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
    root.dispatchEvent(paragraphInput);
    expect(paragraphInput.defaultPrevented).toBe(true);
    expect(editor.document.children[0]).toMatchObject({ type: "code_block", id: "code", children: [{ text: "a\nb" }] });

    expect(dispatchKey("Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.document.children[0]).toMatchObject({ children: [{ text: "a\n\nb" }] });
    expect(dispatchKey("Tab").defaultPrevented).toBe(true);
    expect(editor.document.children[0]).toMatchObject({ children: [{ text: "a\n\n\tb" }] });

    expect(dispatchKey("Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(editor.document.children).toHaveLength(2);
    expect(editor.document.children[1]).toMatchObject({ type: "paragraph", children: [] });
    expect(editor.selection.head).toEqual({ path: [1], offset: 0 });
    pipeline.destroy();
  });
});
