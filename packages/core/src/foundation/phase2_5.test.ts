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
  createTransactionMap,
  foundationSchema,
  resolveScope,
  validate,
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

  it("maps block and list move selections onto the moved subtree", () => {
    const blocks = documentOf("one", "two", "three");
    const blockMove: SmartOperation = {
      type: "moveNode",
      from: { path: [], offset: 2 },
      to: { path: [], offset: 1 },
      nodeId: "p2",
    };
    expect(createTransactionMap([blockMove]).mapSelection(caret(3, [1]))).toEqual(caret(3, [2]));

    const list: SmartDocument = { type: "doc", id: "list-doc", children: [{ type: "list", id: "list", children: [
      { type: "list_item", id: "item-a", children: [paragraph("list-a", "A")] },
      { type: "list_item", id: "item-b", children: [paragraph("list-b", "B")] },
    ] }] };
    const listMove: SmartOperation = {
      type: "moveNode",
      from: { path: [0], offset: 0 },
      to: { path: [0], offset: 1 },
      nodeId: "item-a",
    };
    expect(createTransactionMap([listMove]).mapSelection(caret(1, [0, 1, 0]))).toEqual(caret(1, [0, 0, 0]));
    expect(applyOperation(blocks, blockMove).children.map((node) => node.id)).toEqual(["p0", "p2", "p1"]);
    expect(applyOperation(list, listMove).children[0].children?.map((node) => node.id)).toEqual(["item-b", "item-a"]);
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
  it("projects a visible caret line for an empty paragraph without adding model content", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const before = documentOf("one");
    const renderer = createSubtreeRenderer(root);
    renderer.render(before, caret(3));
    const emptyNode = paragraph("empty", "");
    const emptyDocument = applyOperation(before, {
      type: "insertNode",
      pos: { path: [], offset: 1 },
      node: emptyNode,
    });
    renderer.render(emptyDocument, caret(0, [1]));

    const emptyElement = renderer.mapping.nodeToDom("empty")!;
    const projection = emptyElement.querySelector('[data-smart-empty-line][data-smart-ui="empty-line"]')!;
    expect(projection.tagName).toBe("BR");
    expect(renderer.mapping.domToNode(projection)).toBeNull();
    expect(renderer.mapping.posToDom({ path: [1], offset: 0 })).toEqual({ node: emptyElement, offset: 0 });
    expect(emptyDocument.children[1]).toEqual(emptyNode);

    const withText = applyOperation(emptyDocument, { type: "insertText", pos: { path: [1], offset: 0 }, text: "x" });
    renderer.render(withText, caret(1, [1]));
    expect(emptyElement.querySelector("[data-smart-empty-line]")).toBeNull();
    expect(emptyElement.textContent).toBe("x");
  });

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

  it("retains both moved sibling DOM nodes and the caret owner during a move", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const before = documentOf("one", "two", "three");
    const renderer = createSubtreeRenderer(root);
    renderer.render(before, caret(3, [1]));
    const moved = renderer.mapping.nodeToDom("p1");
    const movedText = moved?.firstChild;
    const following = renderer.mapping.nodeToDom("p2");
    const after = applyOperation(before, {
      type: "moveNode",
      from: { path: [], offset: 2 },
      to: { path: [], offset: 1 },
      nodeId: "p2",
    });
    renderer.render(after, caret(3, [2]));

    expect([...root.children].map((node) => node.getAttribute("data-smart-id"))).toEqual(["p0", "p2", "p1"]);
    expect(renderer.mapping.nodeToDom("p1")).toBe(moved);
    expect(renderer.mapping.nodeToDom("p2")).toBe(following);
    expect(document.getSelection()).toMatchObject({ anchorNode: movedText, anchorOffset: 3, focusNode: movedText, focusOffset: 3 });
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

  it("keeps a composing owner intact when stable-ID sibling reconciliation runs", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const before = documentOf("composing", "sibling");
    const renderer = createSubtreeRenderer(root);
    renderer.render(before, caret(1));
    renderer.beginComposition("p0");
    renderer.resetWriteCounters();
    const composingDom = renderer.mapping.nodeToDom("p0");
    const after = applyOperation(before, {
      type: "moveNode",
      from: { path: [], offset: 1 },
      to: { path: [], offset: 0 },
      nodeId: "p1",
    });
    renderer.render(after, caret(0, [1]));

    expect([...root.children].map((node) => node.getAttribute("data-smart-id"))).toEqual(["p1", "p0"]);
    expect(renderer.mapping.nodeToDom("p0")).toBe(composingDom);
    expect(renderer.composingDomWriteCount).toBe(0);
    renderer.endComposition();
  });

  it("renders media atoms with playback attributes and exposes load failures", () => {
    const root = document.createElement("div");
    const media: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "block_image", id: "image", attrs: {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", alt: "Pixel", status: "ready",
      } },
      { type: "video", id: "video", attrs: { src: "https://cdn.test/clip.mp4", status: "ready" } },
      { type: "audio", id: "audio", attrs: { src: "https://cdn.test/sound.mp3", status: "ready" } },
    ] };
    const renderer = createSubtreeRenderer(root);
    renderer.render(media, { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } });
    const image = root.querySelector<HTMLElement>('[data-smart-type="block_image"]')!;
    const video = root.querySelector<HTMLVideoElement>('[data-smart-type="video"]')!;
    const audio = root.querySelector<HTMLAudioElement>('[data-smart-type="audio"]')!;
    expect(image.getAttribute("src")).toContain("data:image/png");
    expect(video.controls).toBe(true);
    expect(video.preload).toBe("metadata");
    expect(video.playsInline).toBe(true);
    expect(audio.controls).toBe(true);
    expect(audio.preload).toBe("metadata");
    video.dispatchEvent(new Event("error"));
    expect(video.getAttribute("data-smart-media-state")).toBe("error");
    expect(video.getAttribute("title")).toBe("Video could not be loaded");
  });

  it("creates an editable line when navigating past a trailing block atom", () => {
    const root = document.createElement("div");
    const model: SmartDocument = { type: "doc", id: "doc", children: [
      paragraph("before-atom", "before"),
      { type: "block_image", id: "image", attrs: { src: "https://cdn.test/image.png", alt: "Image", status: "ready" } },
    ] };
    const editor = createFoundationEditor({ document: model, selection: {
      type: "node", anchor: { path: [], offset: 1 }, head: { path: [], offset: 2 },
    } });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    pipeline.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(editor.document.children.map((node) => node.type)).toEqual(["paragraph", "block_image", "paragraph"]);
    expect(editor.selection).toMatchObject({ type: "text", anchor: { path: [2], offset: 0 }, head: { path: [2], offset: 0 } });
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

  it("deletes the empty paragraph produced when Enter exits a list", () => {
    const listDocument: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "list", id: "list", children: [{
        type: "list_item", id: "item", children: [paragraph("item-p", "item")],
      }],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: listDocument, selection: caret(4, [0, 0, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string) => root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType,
    }));

    beforeInput("insertParagraph");
    beforeInput("insertParagraph");
    expect(editor.document.children.map((node) => node.type)).toEqual(["list", "paragraph"]);
    expect(editor.selection.head).toEqual({ path: [1], offset: 0 });

    beforeInput("deleteContentBackward");
    expect(editor.document.children.map((node) => node.type)).toEqual(["list"]);
    expect(editor.selection.head).toEqual({ path: [0, 0, 0], offset: 4 });
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("keeps list exit and backward deletion editable inside a blockquote", () => {
    const quotedList: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "blockquote", id: "quote", children: [{
        type: "list", id: "list", children: [{
          type: "list_item", id: "item", children: [paragraph("item-p", "")],
        }],
      }],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: quotedList, selection: caret(0, [0, 0, 0, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string) => root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType,
    }));

    beforeInput("insertParagraph");
    beforeInput("insertParagraph");
    const quote = editor.document.children.find((node) => !("text" in node) && node.id === "quote");
    expect(quote).toMatchObject({ type: "blockquote", children: [
      { type: "paragraph" }, { type: "paragraph" },
    ] });
    expect(editor.selection.head).toEqual({ path: [1, 1], offset: 0 });

    beforeInput("deleteContentBackward");
    const afterDelete = editor.document.children.find((node) => !("text" in node) && node.id === "quote");
    expect(afterDelete).toMatchObject({ type: "blockquote", children: [{ type: "paragraph" }] });
    expect(editor.selection.head).toEqual({ path: [1, 0], offset: 0 });
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("keeps forward deletion editable after list exit inside a blockquote", () => {
    const quotedList: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "blockquote", id: "quote", children: [{
        type: "list", id: "list", children: [{
          type: "list_item", id: "item", children: [paragraph("item-p", "")],
        }],
      }],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: quotedList, selection: caret(0, [0, 0, 0, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string) => root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType,
    }));

    beforeInput("insertParagraph");
    beforeInput("insertParagraph");
    expect(() => beforeInput("deleteContentForward")).not.toThrow();
    expect(editor.selection.head.path).toEqual([2]);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("exits a depth-zero list from the newly-created empty trailing item", () => {
    const listDocument: SmartDocument = { type: "doc", id: "list-exit-doc", children: [{
      type: "list", id: "list-exit", attrs: { style: "disc" }, children: Array.from({ length: 5 }, (_, index) => ({
        type: "list_item" as const,
        id: `list-exit-item-${index}`,
        children: [paragraph(`list-exit-p-${index}`, `item ${index + 1}`)],
      })),
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: listDocument, selection: caret(6, [0, 2, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string) => root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType,
    }));

    beforeInput("insertParagraph");
    expect(editor.selection.head.path).toEqual([0, 3, 0]);
    beforeInput("insertParagraph");

    // The exited item was in the middle of the original list, so unwrapping
    // it splits the surrounding list rather than dropping the following
    // items. The paragraph is the reachable exit position between fragments.
    expect(editor.document.children.map((node) => node.type)).toEqual(["list", "paragraph", "list"]);
    expect(editor.document.children[0]).toMatchObject({ type: "list", children: [
      { id: "list-exit-item-0" }, { id: "list-exit-item-1" }, { id: "list-exit-item-2" },
    ] });
    expect(editor.document.children[2]).toMatchObject({ type: "list", children: [
      { id: "list-exit-item-3" }, { id: "list-exit-item-4" },
    ] });
    expect(editor.selection.head.path).toEqual([1]);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("exits after a trailing list item instead of creating empty items forever", () => {
    const listDocument: SmartDocument = { type: "doc", id: "trailing-list-exit-doc", children: [{
      type: "list", id: "trailing-list", attrs: { style: "disc" }, children: Array.from({ length: 5 }, (_, index) => ({
        type: "list_item" as const,
        id: `trailing-item-${index}`,
        children: [paragraph(`trailing-p-${index}`, `item ${index + 1}`)],
      })),
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: listDocument, selection: caret(6, [0, 4, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = (inputType: string) => root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType,
    }));

    beforeInput("insertParagraph");
    expect(editor.selection.head.path).toEqual([0, 5, 0]);
    beforeInput("insertParagraph");

    expect(editor.document.children.map((node) => node.type)).toEqual(["list", "paragraph"]);
    expect(editor.document.children[0]).toMatchObject({ type: "list", children: [
      { id: "trailing-item-0" }, { id: "trailing-item-1" }, { id: "trailing-item-2" },
      { id: "trailing-item-3" }, { id: "trailing-item-4" },
    ] });
    expect(editor.selection.head.path).toEqual([1]);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("keeps Enter as a code newline when the code block is inside a quote", () => {
    const quotedCode: SmartDocument = { type: "doc", id: "quoted-code-doc", children: [{
      type: "blockquote", id: "quoted-code-quote", children: [{
        type: "code_block", id: "quoted-code", attrs: { language: "ts" }, children: [{ type: "text", text: "abc" }],
      }],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: quotedCode, selection: caret(1, [0, 0]) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const beforeInput = root.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertParagraph",
    }));

    expect(beforeInput).toBe(false);
    const quote = editor.document.children.find((node) => !("text" in node) && node.id === "quoted-code-quote");
    expect(quote).toMatchObject({ type: "blockquote", children: [{ type: "code_block", children: [{ text: "a\nbc" }] }] });
    expect(editor.document.children.map((node) => node.type)).toEqual(["paragraph", "blockquote", "paragraph"]);
    expect(editor.selection.head.path).toEqual([1, 0]);
    expect(editor.selection.head.offset).toBe(2);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("provides editable boundary positions around adjacent quotes", () => {
    const quotes: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "blockquote", id: "quote-a", children: [paragraph("quote-a-p", "A")] },
      { type: "blockquote", id: "quote-b", children: [paragraph("quote-b-p", "B")] },
    ] };
    const editor = createFoundationEditor({ document: quotes, selection: caret(0, [0, 0]) });
    expect(editor.document.children.map((node) => node.type)).toEqual([
      "paragraph", "blockquote", "paragraph", "blockquote", "paragraph",
    ]);
    expect(editor.selection.head.path).toEqual([1, 0]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(editor.document, editor.selection);
    expect(renderer.mapping.posToDom({ path: [0], offset: 0 })).not.toBeNull();
    expect(renderer.mapping.posToDom({ path: [2], offset: 0 })).not.toBeNull();
    expect(renderer.mapping.posToDom({ path: [4], offset: 0 })).not.toBeNull();
    const pipeline = createInputPipeline(editor, renderer, root);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(editor.selection.head.path).toEqual([0]);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(editor.selection.head.path).toEqual([1, 0]);
    pipeline.destroy();
  });

  it("collapses reverse and forward selections to the same arrow endpoints", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({
      document: documentOf("012345", "abcdef", "uvwxyz"),
      selection: { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [2], offset: 4 } },
    });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const dispatch = (key: "ArrowLeft" | "ArrowRight") => pipeline.handleKeyDown(new KeyboardEvent("keydown", { key }));

    dispatch("ArrowLeft");
    expect(editor.selection).toEqual(caret(2, [0]));

    editor.setSelection({ type: "text", anchor: { path: [2], offset: 4 }, head: { path: [0], offset: 2 } });
    renderer.render(editor.document, editor.selection);
    dispatch("ArrowLeft");
    expect(editor.selection).toEqual(caret(2, [0]));

    editor.setSelection({ type: "text", anchor: { path: [0], offset: 2 }, head: { path: [2], offset: 4 } });
    renderer.render(editor.document, editor.selection);
    dispatch("ArrowRight");
    expect(editor.selection).toEqual(caret(4, [2]));

    editor.setSelection({ type: "text", anchor: { path: [2], offset: 4 }, head: { path: [0], offset: 2 } });
    renderer.render(editor.document, editor.selection);
    dispatch("ArrowRight");
    expect(editor.selection).toEqual(caret(4, [2]));
    pipeline.destroy();
  });

  it("preserves consecutive spaces as ordinary live-model text", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: documentOf("x"), selection: caret(1) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    for (let index = 0; index < 4; index += 1) {
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }));
    }
    expect(editor.document.children[0]).toEqual(paragraph("p0", "x    "));
    expect(editor.selection).toEqual(caret(5));
    pipeline.destroy();
  });

  it("deletes whole-document selections for lists, tables, and atoms", () => {
    const documents: SmartDocument[] = [
      documentOf("first", "second"),
      { type: "doc", id: "list-doc", children: [{ type: "list", id: "list", children: [{ type: "list_item", id: "item", children: [paragraph("item-p", "item")] }] }] },
      { type: "doc", id: "table-doc", children: [{ type: "table", id: "table", children: [{ type: "table_row", id: "row", children: [{ type: "table_cell", id: "cell", children: [paragraph("cell-p", "cell")] }] }] }] },
      { type: "doc", id: "atom-doc", children: [{ type: "block_image", id: "image", attrs: { src: "https://cdn.test/image.png", alt: "Image", status: "ready" } }] },
    ];
    documents.forEach((documentValue) => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const selection = { type: "text" as const, anchor: { path: [], offset: 0 }, head: { path: [], offset: documentValue.children.length } };
      const editor = createFoundationEditor({ document: documentValue, selection });
      const renderer = createSubtreeRenderer(root);
      const pipeline = createInputPipeline(editor, renderer, root);
      pipeline.syncSelectionFromDom();
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
      expect(editor.document.children).toHaveLength(1);
      expect(editor.document.children[0]).toMatchObject({ type: "paragraph", children: [] });
      expect(editor.selection).toEqual(caret(0, [0]));
      expect(validate(editor.document, foundationSchema)).toEqual([]);
      pipeline.destroy();
    });
  });

  it("deletes a multi-item list range as structural list items", () => {
    const model: SmartDocument = { type: "doc", id: "delete-list-doc", children: [{
      type: "list", id: "delete-list", children: Array.from({ length: 5 }, (_, index) => ({
        type: "list_item" as const, id: `delete-item-${index}`, children: [paragraph(`delete-p-${index}`, `item ${index}`)],
      })),
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: model, selection: {
      type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 3, 0], offset: 6 },
    } });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentForward" }));

    expect((editor.document.children[0] as SmartDocument["children"][number]).children?.map((node) => node.id)).toEqual([
      "delete-item-0", "delete-item-4",
    ]);
    expect(editor.selection.head.path).toEqual([0, 1, 0]);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("deletes node-selected blockquotes and code blocks", () => {
    const model: SmartDocument = { type: "doc", id: "delete-block-doc", children: [
      { type: "blockquote", id: "delete-quote", children: [paragraph("delete-quote-p", "quote")] },
      { type: "code_block", id: "delete-code", children: [{ type: "text", text: "code" }] },
      paragraph("delete-after", "after"),
    ] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: model, selection: {
      type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 },
    } });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const selectNode = (id: string) => {
      const position = editor.positions.positionOf(id)!;
      const selection = { type: "node" as const, anchor: position.pos, head: { path: [...position.pos.path], offset: position.pos.offset + 1 } };
      editor.setSelection(selection);
      renderer.render(editor.document, selection);
    };
    selectNode("delete-quote");
    expect(editor.selection).toMatchObject({ type: "node", anchor: { offset: 1 }, head: { offset: 2 } });
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentForward" }));
    expect(editor.document.children.map((node) => node.id)).toEqual([
      "smart-boundary-delete-block-doc-before-delete-quote", "delete-code", "delete-after",
    ]);

    selectNode("delete-code");
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentForward" }));
    expect(editor.document.children.map((node) => node.id)).toEqual([
      "smart-boundary-delete-block-doc-before-delete-quote", "delete-after",
    ]);
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("deletes mixed list and plain-block selections without throwing", () => {
    const model: SmartDocument = { type: "doc", id: "delete-mixed-doc", children: [
      { type: "list", id: "delete-mixed-list", children: [
        { type: "list_item", id: "delete-mixed-a", children: [paragraph("delete-mixed-a-p", "a")] },
        { type: "list_item", id: "delete-mixed-b", children: [paragraph("delete-mixed-b-p", "b")] },
      ] },
      paragraph("delete-mixed-after", "after"),
    ] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: model, selection: {
      type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [1], offset: 5 },
    } });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    expect(() => root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentForward" }))).not.toThrow();
    expect(editor.document.children).toHaveLength(1);
    expect(editor.document.children[0]).toMatchObject({ type: "paragraph", children: [] });
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("deletes only a partial list selection and preserves whole-list deletion", () => {
    const makeListDocument = (count: number, idPrefix: string): SmartDocument => ({
      type: "doc", id: `${idPrefix}-doc`, children: [{
        type: "list", id: `${idPrefix}-list`, children: Array.from({ length: count }, (_, index) => ({
          type: "list_item" as const, id: `${idPrefix}-item-${index}`, children: [paragraph(`${idPrefix}-p-${index}`, `item ${index}`)],
        })),
      }],
    });
    const run = (model: SmartDocument, selection: SmartSelection, inputType: "deleteContentForward" | "deleteContentBackward") => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const editor = createFoundationEditor({ document: model, selection });
      const renderer = createSubtreeRenderer(root);
      const pipeline = createInputPipeline(editor, renderer, root);
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType }));
      pipeline.destroy();
      return editor.document;
    };

    const partial = run(makeListDocument(5, "subset-forward"), {
      type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 6 },
    }, "deleteContentForward");
    expect(partial.children[0]).toMatchObject({
      type: "list",
      children: [{ id: "subset-forward-item-0" }, { id: "subset-forward-item-3" }, { id: "subset-forward-item-4" }],
    });
    expect(validate(partial, foundationSchema)).toEqual([]);

    const boundarySubset = run(makeListDocument(5, "subset-boundary"), {
      type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 3, 0], offset: 0 },
    }, "deleteContentForward");
    expect(boundarySubset.children[0]).toMatchObject({
      type: "list",
      children: [{ id: "subset-boundary-item-0" }, { id: "subset-boundary-item-3" }, { id: "subset-boundary-item-4" }],
    });
    expect(validate(boundarySubset, foundationSchema)).toEqual([]);

    const partialBackward = run(makeListDocument(5, "subset-backward"), {
      type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 6 },
    }, "deleteContentBackward");
    expect(partialBackward.children[0]).toMatchObject({
      type: "list",
      children: [{ id: "subset-backward-item-0" }, { id: "subset-backward-item-3" }, { id: "subset-backward-item-4" }],
    });

    const twoItemSubset = run(makeListDocument(2, "two-item"), {
      type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 },
    }, "deleteContentForward");
    expect(twoItemSubset.children[0]).toMatchObject({
      type: "list", children: [{ id: "two-item-item-1" }],
    });
    expect(validate(twoItemSubset, foundationSchema)).toEqual([]);

    const wholeList = run(makeListDocument(3, "whole-list"), {
      type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 6 },
    }, "deleteContentForward");
    expect(wholeList.children).toHaveLength(1);
    expect(wholeList.children[0]).toMatchObject({ type: "paragraph", children: [] });
    expect(validate(wholeList, foundationSchema)).toEqual([]);
  });

  it("keeps marked runs and stored marks across a paragraph split", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const marked: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p0", children: [
        { type: "text", text: "large", marks: [{ type: "fontSize", attrs: { valuePx: 24 } }, { type: "bold" }] },
        { type: "text", text: "tail", marks: [{ type: "fontSize", attrs: { valuePx: 24 } }, { type: "bold" }, { type: "textColor", attrs: { value: "#ff0000" } }] },
      ] },
      paragraph("below", "untouched"),
    ] };
    const beforeBelow = marked.children[1];
    const editor = createFoundationEditor({ document: marked, selection: caret(3) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" }));

    expect(editor.document.children[0]).toMatchObject({ children: [{ type: "text", text: "lar", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] }] });
    expect((editor.document.children[1] as { children?: SmartDocument["children"] }).children).toEqual([
      { type: "text", text: "ge", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] },
      { type: "text", text: "tail", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }, { type: "textColor", attrs: { value: "#ff0000" } }] },
    ]);
    expect(editor.document.children[2]).toMatchObject({ id: beforeBelow.id, type: "paragraph", children: [{ type: "text", text: "untouched" }] });
    expect(editor.selection).toEqual(caret(0, [1]));
    expect(editor.storedMarks).toEqual([{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }]);

    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "X" }));
    expect(editor.document.children[1]).toMatchObject({ children: [
      { type: "text", text: "Xge", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }] },
      { type: "text", text: "tail", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 24 } }, { type: "textColor", attrs: { value: "#ff0000" } }] },
    ] });
    pipeline.destroy();
  });

  it("applies boundary marks to the new block without changing later structure", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const marked: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p0", children: [
        { type: "text", text: "plain" },
        { type: "text", text: "marked", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 20 } }, { type: "textColor", attrs: { value: "#0000ff" } }] },
      ] },
      paragraph("below", "stable"),
    ] };
    const below = marked.children[1];
    const editor = createFoundationEditor({ document: marked, selection: caret(5) });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" }));
    expect(editor.document.children[1]).toMatchObject({ children: [{ type: "text", text: "marked", marks: [{ type: "bold" }, { type: "fontSize", attrs: { valuePx: 20 } }, { type: "textColor", attrs: { value: "#0000ff" } }] }] });
    expect(editor.document.children[2]).toMatchObject({ id: below.id, type: "paragraph", children: [{ type: "text", text: "stable" }] });
    expect(validate(editor.document, foundationSchema)).toEqual([]);
    pipeline.destroy();
  });

  it("clears stale cell height presentation while retaining row-level height", () => {
    const before: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "table", id: "table", children: [{
        type: "table_row", id: "row", attrs: { height: 48 }, children: [{
          type: "table_cell", id: "cell", children: [paragraph("cell-p", "A")],
        }],
      }],
    }] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    const selection = caret(1, [0, 0, 0, 0]);
    renderer.render(before, selection);
    const cell = renderer.mapping.nodeToDom("cell")!;
    cell.style.height = "96px";
    cell.style.minHeight = "96px";
    cell.style.maxHeight = "96px";
    cell.setAttribute("height", "96");

    const after = structuredClone(before);
    const table = after.children[0];
    if (table.type === "text") throw new Error("table fixture unexpectedly contains text");
    const row = table.children![0];
    if (row.type === "text") throw new Error("row fixture unexpectedly contains text");
    const cellNode = row.children![0];
    if (cellNode.type === "text") throw new Error("cell fixture unexpectedly contains text");
    cellNode.children = [paragraph("cell-p", "AB")];
    renderer.render(after, selection);

    expect(renderer.mapping.nodeToDom("row")?.style.height).toBe("48px");
    expect(renderer.mapping.nodeToDom("cell")?.style.height).toBe("");
    expect(renderer.mapping.nodeToDom("cell")?.style.minHeight).toBe("");
    expect(renderer.mapping.nodeToDom("cell")?.style.maxHeight).toBe("");
    expect(renderer.mapping.nodeToDom("cell")?.hasAttribute("height")).toBe(false);
  });

  it("keeps one valid editable paragraph when a whole document is deleted", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({
      document: documentOf("first", "second"),
      selection: { type: "text", anchor: { path: [], offset: 0 }, head: { path: [], offset: 2 } },
    });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.document.children).toHaveLength(1);
    expect(editor.document.children[0]).toMatchObject({ type: "paragraph", children: [] });
    expect(editor.selection.head).toEqual({ path: [0], offset: 0 });
    expect(validate(editor.document, foundationSchema)).toEqual([]);
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
