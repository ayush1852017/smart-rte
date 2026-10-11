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
    });
    expect(runtime.listImages()).toEqual([{ nodeId: expect.any(String), src: "https://example.com/a.png", alt: "A", caption: "Chart" }]);
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
