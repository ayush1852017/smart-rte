// @vitest-environment jsdom
import React, { createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTextNode, type SmartElementNode, type SmartNode } from "smartrte-core/foundation";
import { CanonicalEditorRuntime, type SmartEditorHandle } from "./canonicalEditorRuntime.js";
import { CanonicalAuthorityEditor } from "./components/CanonicalAuthorityEditor.js";
import { planBlockAtomInsertion } from "./insertion.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// MediaOverlay (the selected image's resize handles) observes its target's size.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const types = (nodes: readonly SmartNode[]) => nodes.map((node) => isTextNode(node) ? "text" : node.type);
const caretIn = (runtime: CanonicalEditorRuntime, path: number[], offset = 0) =>
  runtime.editor.setSelection({ type: "text", anchor: { path, offset }, head: { path, offset } }, { source: "api" });
const mounted = (runtime: CanonicalEditorRuntime) => {
  const root = document.createElement("div");
  document.body.appendChild(root);
  runtime.mount(root);
  return root;
};
const image = { src: "https://example.com/figure.png", alt: "A figure", caption: "Figure 1: growth" };

describe("insertImage", () => {
  it("inserts after the paragraph holding the last caret, exactly where the toolbar insert would", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p><p>two</p>" });
    caretIn(runtime, [0], 2);
    const toolbarPlan = planBlockAtomInsertion(runtime.editor, "block_image", { src: image.src, alt: image.alt, status: "ready" }, "probe");
    expect(toolbarPlan?.operations[0]).toMatchObject({ type: "insertNode", pos: { path: [], offset: 1 } });
    const result = runtime.insertImage(image);
    expect(result).toEqual({ ok: true, nodeId: expect.any(String) });
    const children = runtime.editor.document.children as SmartElementNode[];
    expect(types(children)).toEqual(["paragraph", "block_image", "paragraph"]);
    expect(children[1]).toMatchObject({ id: result.ok && result.nodeId, attrs: { src: image.src, alt: image.alt, caption: image.caption, status: "ready" } });
    // The new image is selected so the user can see what was inserted.
    expect(runtime.editor.selection).toMatchObject({ type: "node", anchor: { path: [], offset: 1 }, head: { path: [], offset: 2 } });
  });

  it("inserts after a selected block atom, inside a selected table cell, and at the end on request", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: '<p>one</p><img src="https://example.com/a.png" alt="A"><table><tr><td><p>cell</p></td></tr></table>' });
    const indexOf = (type: string) => runtime.editor.document.children.findIndex((node) => !isTextNode(node) && node.type === type);
    const existing = indexOf("block_image");
    runtime.editor.setSelection({ type: "node", anchor: { path: [], offset: existing }, head: { path: [], offset: existing + 1 } }, { source: "api" });
    const toolbarPlan = planBlockAtomInsertion(runtime.editor, "block_image", { src: image.src, alt: image.alt, status: "ready" }, "probe")!;
    expect(toolbarPlan.operations[0]).toMatchObject({ type: "insertNode", pos: { path: [], offset: existing + 1 } });
    const afterAtom = runtime.insertImage(image);
    // Directly after the selected atom (the editor's own normalisation then
    // keeps an editable boundary paragraph between two adjacent atoms).
    const ids = runtime.editor.document.children.map((node) => isTextNode(node) ? "" : node.id);
    const inserted = ids.indexOf(afterAtom.ok ? afterAtom.nodeId : "");
    expect(inserted).toBeGreaterThan(existing);
    expect(types(runtime.editor.document.children.slice(existing + 1, inserted))).toEqual(["paragraph"]);
    expect(inserted).toBeLessThan(indexOf("table"));
    const table = indexOf("table");
    caretIn(runtime, [table, 0, 0, 0], 1);
    runtime.insertImage({ ...image, caption: "In cell" });
    const cell = ((runtime.editor.document.children[table] as SmartElementNode).children![0] as SmartElementNode).children![0] as SmartElementNode;
    expect(types(cell.children!)).toEqual(["paragraph", "block_image", "paragraph"]);
    expect((cell.children![1] as SmartElementNode).attrs?.caption).toBe("In cell");
    runtime.insertImage({ ...image, caption: "Last" }, { position: "end" });
    const children = runtime.editor.document.children as SmartElementNode[];
    expect(children.at(-2)).toMatchObject({ type: "block_image", attrs: { caption: "Last" } });
    // A block atom at the end of a container is followed by an editable paragraph.
    expect(children.at(-1)?.type).toBe("paragraph");
  });

  it("is one undo step and fires onChange/onHtmlChange", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const onHtmlChange = vi.fn();
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p><p>two</p>", onChange, onHtmlChange });
    mounted(runtime);
    caretIn(runtime, [0]);
    const before = runtime.getValue().document;
    runtime.insertImage(image);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ documentChanged: true }));
    vi.advanceTimersByTime(300);
    expect(onHtmlChange).toHaveBeenLastCalledWith(expect.stringContaining('<figure data-smart-figure="true"><img data-smart-type="block_image" src="https://example.com/figure.png" alt="A figure" data-smart-status="ready"><figcaption>Figure 1: growth</figcaption></figure>'));
    expect(runtime.editor.undo()).toBe(true);
    expect(runtime.getValue().document).toEqual(before);
    runtime.unmount();
  });

  it("refuses in read-only mode and rejects invalid input with a reason instead of throwing", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p>" });
    runtime.setReadOnly(true);
    expect(runtime.insertImage(image)).toEqual({ ok: false, reason: "read_only" });
    runtime.setReadOnly(false);
    expect(runtime.insertImage({ src: image.src, alt: "" })).toEqual({ ok: false, reason: "invalid_image" });
    expect(runtime.insertImage({ src: "javascript:alert(1)", alt: "x" })).toEqual({ ok: false, reason: "invalid_image" });
    expect(runtime.insertImage({ src: image.src, alt: "x", width: -4 })).toEqual({ ok: false, reason: "invalid_image" });
    expect(runtime.insertImage({ src: image.src, alt: "x", align: "middle" as never })).toEqual({ ok: false, reason: "invalid_image" });
    expect(runtime.insertImage(null as never)).toEqual({ ok: false, reason: "invalid_image" });
    expect(types(runtime.editor.document.children)).toEqual(["paragraph"]);
    // Decorative images may omit alt; an over-long caption is normalised, not rejected.
    const decorative = runtime.insertImage({ src: image.src, alt: "", decorative: true, caption: `  ${"x".repeat(600)} ` });
    expect(decorative.ok).toBe(true);
    const inserted = (runtime.editor.document.children as SmartElementNode[]).find((node) => node.type === "block_image")!;
    expect(String(inserted.attrs?.caption)).toHaveLength(500);
  });

  it("keeps only allowlisted metadata", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p>", imageMetadataAttributes: ["data-ai-generated", "data-source-ref", "data-smart-nope", "Bad"] });
    expect(runtime.imageMetadataAttributes).toEqual(["data-ai-generated", "data-source-ref"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("data-smart-nope, Bad"));
    runtime.insertImage({ ...image, metadata: { "data-ai-generated": "true", "data-source-ref": "fj_8Kq2", "data-other": "dropped" } });
    const inserted = (runtime.editor.document.children as SmartElementNode[]).find((node) => node.type === "block_image")!;
    expect(inserted.attrs?.metadata).toEqual({ "data-ai-generated": "true", "data-source-ref": "fj_8Kq2" });
    // Without an allowlist nothing is stored.
    const plain = new CanonicalEditorRuntime({ initialValue: "<p>one</p>" });
    plain.insertImage({ ...image, metadata: { "data-ai-generated": "true" } });
    expect((plain.editor.document.children as SmartElementNode[]).find((node) => node.type === "block_image")!.attrs).not.toHaveProperty("metadata");
  });

  it("does not steal focus from the host's panel unless asked, and uses the caret from before the panel took focus", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p><p>two</p><p>three</p>" });
    const root = mounted(runtime);
    caretIn(runtime, [1], 1);
    const panelInput = document.createElement("input");
    document.body.appendChild(panelInput);
    panelInput.focus();
    // The host's panel taking focus moves the native selection out of the editor.
    document.getSelection()?.selectAllChildren(panelInput.parentElement!.lastElementChild!);
    document.dispatchEvent(new Event("selectionchange"));
    expect(runtime.editor.selection.head).toEqual({ path: [1], offset: 1 });
    // getSectionContext reads that same last-known caret while the panel has focus.
    expect(runtime.getSectionContext().text).toBe("one\n\ntwo\n\nthree");
    expect(runtime.editor.selection.head.path).toEqual([1]);
    runtime.insertImage(image);
    expect(document.activeElement).toBe(panelInput);
    expect(types(runtime.editor.document.children)).toEqual(["paragraph", "paragraph", "block_image", "paragraph"]);
    runtime.insertImage(image, { focus: true });
    expect(document.activeElement).toBe(root);
    runtime.unmount();
  });

  it("answers section-context and image-list queries", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: '<h2>Results</h2><p>Growth was strong.</p><figure><img src="https://example.com/a.png" alt="A"><figcaption>Chart</figcaption></figure><h2>Next</h2>' });
    caretIn(runtime, [1], 3);
    runtime.setReadOnly(true);
    expect(runtime.getSectionContext()).toEqual({
      heading: { id: expect.any(String), level: 2, text: "Results" },
      text: "Growth was strong.\n\n[Figure: Chart]",
      truncated: false,
      caretSetByUser: false,
    });
    expect(runtime.listImages()).toEqual([{ nodeId: expect.any(String), src: "https://example.com/a.png", alt: "A", caption: "Chart" }]);
  });
});

describe("insertImage section positions (1.3.0)", () => {
  const sectioned = "<p>Intro</p><h2>A</h2><p>a1</p><h3>A.1</h3><p>a2</p><h2>B</h2><p>b1</p>";
  const headingId = (runtime: CanonicalEditorRuntime, text: string) => runtime.listSections().find((section) => section.text === text)!.headingId;
  const texts = (runtime: CanonicalEditorRuntime) => (runtime.editor.document.children as SmartElementNode[]).map((node) =>
    node.type === "block_image" ? `IMG:${node.attrs?.caption ?? ""}` : (node.children || []).map((child) => isTextNode(child) ? child.text : "").join(""));

  it("lists sections like getSectionContext does", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: `${sectioned}<blockquote><h2>Quoted</h2></blockquote>` });
    expect(runtime.listSections()).toEqual([
      { headingId: expect.any(String), level: 2, text: "A", index: 0 },
      { headingId: expect.any(String), level: 3, text: "A.1", index: 1 },
      { headingId: expect.any(String), level: 2, text: "B", index: 2 },
    ]);
  });

  it("inserts at the end of a middle section, the last section and the intro without a user caret", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: sectioned });
    // A level-2 section spans its level-3 subsection: the image goes right before "B".
    expect(runtime.insertImage({ ...image, caption: "end of A" }, { position: { sectionEnd: headingId(runtime, "A") } }).ok).toBe(true);
    expect(texts(runtime)).toEqual(["Intro", "A", "a1", "A.1", "a2", "IMG:end of A", "B", "b1"]);
    runtime.insertImage({ ...image, caption: "end of A.1" }, { position: { sectionEnd: headingId(runtime, "A.1") } });
    // Also right before "B" (A.1 ends there too); normalisation keeps an
    // editable paragraph between the two adjacent images.
    expect(texts(runtime)).toEqual(["Intro", "A", "a1", "A.1", "a2", "IMG:end of A", "", "IMG:end of A.1", "B", "b1"]);
    runtime.insertImage({ ...image, caption: "end of B" }, { position: { sectionEnd: headingId(runtime, "B") } });
    // At the very end, an editable paragraph follows the image.
    expect(texts(runtime).slice(-3)).toEqual(["b1", "IMG:end of B", ""]);
    runtime.insertImage({ ...image, caption: "intro" }, { position: { sectionEnd: null } });
    expect(texts(runtime).slice(0, 3)).toEqual(["Intro", "IMG:intro", "A"]);
    // The selection-based default was never used: the caret was never placed.
    expect(runtime.hasUserCaret()).toBe(false);
  });

  it("inserts directly after a named top-level block", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: sectioned });
    const a1 = (runtime.editor.document.children[2] as SmartElementNode).id;
    const result = runtime.insertImage({ ...image, caption: "after a1" }, { position: { after: a1 } });
    expect(result.ok).toBe(true);
    expect(texts(runtime).slice(2, 4)).toEqual(["a1", "IMG:after a1"]);
    expect(runtime.editor.selection).toMatchObject({ type: "node", anchor: { path: [], offset: 3 } });
  });

  it("refuses an unknown or non-top-level id instead of inserting somewhere else", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: `${sectioned}<blockquote><h2>Quoted</h2><p>q</p></blockquote>` });
    const before = runtime.getValue().document;
    const quote = (runtime.editor.document.children as SmartElementNode[]).find((node) => node.type === "blockquote")!;
    const nestedHeading = (quote.children![0] as SmartElementNode).id;
    const nestedParagraph = (quote.children![1] as SmartElementNode).id;
    const a1 = (runtime.editor.document.children[2] as SmartElementNode).id;
    expect(runtime.insertImage(image, { position: { sectionEnd: "missing" } })).toEqual({ ok: false, reason: "no_valid_position" });
    expect(runtime.insertImage(image, { position: { sectionEnd: nestedHeading } })).toEqual({ ok: false, reason: "no_valid_position" });
    expect(runtime.insertImage(image, { position: { sectionEnd: a1 } })).toEqual({ ok: false, reason: "no_valid_position" });
    expect(runtime.insertImage(image, { position: { after: "missing" } })).toEqual({ ok: false, reason: "no_valid_position" });
    expect(runtime.insertImage(image, { position: { after: nestedParagraph } })).toEqual({ ok: false, reason: "no_valid_position" });
    expect(runtime.getValue().document).toEqual(before);
    // read_only and invalid input are still reported first.
    runtime.setReadOnly(true);
    expect(runtime.insertImage(image, { position: { sectionEnd: "missing" } })).toEqual({ ok: false, reason: "read_only" });
  });

  it("is one undo step", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: sectioned });
    const before = runtime.getValue().document;
    runtime.insertImage(image, { position: { sectionEnd: headingId(runtime, "A") } });
    expect(runtime.editor.undo()).toBe(true);
    expect(runtime.getValue().document).toEqual(before);
    expect(runtime.editor.redo()).toBe(true);
    expect(texts(runtime)[5]).toBe(`IMG:${image.caption}`);
  });
});

describe("hasUserCaret (1.3.0)", () => {
  const press = (root: HTMLElement, type: string) => root.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

  it("is false after mount and becomes true on a click or key press inside the editor", () => {
    for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
      const runtime = new CanonicalEditorRuntime({ initialValue: "<h2>A</h2><p>one</p>" });
      const root = mounted(runtime);
      expect(runtime.hasUserCaret()).toBe(false);
      expect(runtime.getSectionContext().caretSetByUser).toBe(false);
      press(root.firstElementChild as HTMLElement ?? root, type);
      expect(runtime.hasUserCaret(), type).toBe(true);
      expect(runtime.getSectionContext().caretSetByUser).toBe(true);
      runtime.unmount();
    }
  });

  it("ignores programmatic selection, focus() and insertImage, and input outside the editor", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p><p>two</p>" });
    const root = mounted(runtime);
    caretIn(runtime, [1], 1);
    runtime.focus();
    runtime.insertImage(image);
    runtime.insertImage(image, { focus: true });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    press(outside, "pointerdown");
    press(outside, "keydown");
    expect(runtime.hasUserCaret()).toBe(false);
    press(root, "keydown");
    expect(runtime.hasUserCaret()).toBe(true);
    runtime.unmount();
  });

  it("resets on replaceValue and restoreVersion; a checkpoint restores the value it was taken with", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p>" });
    const root = mounted(runtime);
    const beforeClick = runtime.createCheckpoint();
    press(root, "pointerdown");
    const afterClick = runtime.createCheckpoint();
    runtime.restoreCheckpoint(afterClick);
    expect(runtime.hasUserCaret()).toBe(true);
    runtime.restoreCheckpoint(beforeClick);
    expect(runtime.hasUserCaret()).toBe(false);
    press(root, "pointerdown");
    // A checkpoint this runtime didn't create (e.g. deserialized) counts as a fresh load.
    runtime.restoreCheckpoint(structuredClone(afterClick));
    expect(runtime.hasUserCaret()).toBe(false);
    press(root, "pointerdown");
    const version = runtime.saveVersion();
    runtime.restoreVersion(version);
    expect(runtime.hasUserCaret()).toBe(false);
    press(root, "pointerdown");
    runtime.replaceValue(runtime.getValue());
    expect(runtime.hasUserCaret()).toBe(false);
    runtime.unmount();
  });
});

describe("CanonicalAuthorityEditor image captions", () => {
  const render = (props: Partial<React.ComponentProps<typeof CanonicalAuthorityEditor>> = {}) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    const ref = createRef<SmartEditorHandle>();
    let runtime: CanonicalEditorRuntime | null = null;
    act(() => reactRoot.render(<CanonicalAuthorityEditor ref={ref} onRuntime={(value) => { runtime = value; }} {...props} />));
    return { host, ref, reactRoot, runtime: () => runtime! };
  };
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("exposes insertImage through the ref and honours the readOnly prop", () => {
    const { ref, reactRoot } = render({ defaultValue: "<p>one</p>", readOnly: true });
    expect(ref.current!.insertImage(image)).toEqual({ ok: false, reason: "read_only" });
    act(() => reactRoot.render(<CanonicalAuthorityEditor ref={ref} defaultValue="<p>one</p>" readOnly={false} />));
    expect(ref.current!.insertImage(image).ok).toBe(true);
    act(() => reactRoot.unmount());
  });

  it("loads host metadata from defaultValue when allowlisted", () => {
    const { runtime, reactRoot } = render({ defaultValue: '<img src="https://example.com/a.png" alt="A" data-ai-generated="true">', imageMetadataAttributes: ["data-ai-generated"] });
    expect((runtime().editor.document.children as SmartElementNode[]).find((node) => node.type === "block_image")!.attrs?.metadata).toEqual({ "data-ai-generated": "true" });
    act(() => reactRoot.unmount());
  });

  it("edits, renders and removes a caption from Media details in one history step each; the field is for block images only", () => {
    const { host, runtime, reactRoot } = render({ defaultValue: '<p>Text <img src="https://example.com/inline.png" alt="Inline"></p><img src="https://example.com/a.png" alt="Block">' });
    const editorRoot = host.querySelector<HTMLElement>('[data-smart-canonical-surface="true"]')!;
    const block = editorRoot.querySelector<HTMLElement>('img[data-smart-type="block_image"]')!;
    act(() => { block.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    const captionInput = document.querySelector<HTMLInputElement>("[data-srte-media-caption-input]")!;
    expect(captionInput).not.toBeNull();
    expect(document.body.textContent).toContain("Shown under the image. Alt text is read by screen readers.");
    act(() => setInput(captionInput, "  A   new caption "));
    const historyBefore = runtime().editor.state.revision;
    act(() => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Apply")!.click(); });
    const blockNode = () => (runtime().editor.document.children as SmartElementNode[]).find((node) => node.type === "block_image")!;
    expect(blockNode().attrs?.caption).toBe("A new caption");
    expect(runtime().editor.state.revision).toBe(historyBefore + 1);
    const projection = editorRoot.querySelector<HTMLElement>('[data-smart-projection="image-caption"]')!;
    expect(projection.textContent).toBe("A new caption");
    expect(block.nextSibling).toBe(projection);

    // Clicking the rendered caption reopens Media details on the Caption field.
    act(() => { projection.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const reopened = document.querySelector<HTMLInputElement>("[data-srte-media-caption-input]")!;
    expect(reopened.value).toBe("A new caption");
    act(() => setInput(reopened, ""));
    act(() => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Apply")!.click(); });
    expect(blockNode().attrs).not.toHaveProperty("caption");
    expect(editorRoot.querySelector('[data-smart-projection="image-caption"]')).toBeNull();
    expect(runtime().editor.undo()).toBe(true);
    expect(blockNode().attrs?.caption).toBe("A new caption");

    // Inline images get no Caption field.
    const inline = editorRoot.querySelector<HTMLElement>('img[data-smart-type="image"]')!;
    act(() => { inline.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(document.querySelector("[data-srte-media-alt-input]")).not.toBeNull();
    expect(document.querySelector("[data-srte-media-caption-input]")).toBeNull();
    act(() => reactRoot.unmount());
  });
});
