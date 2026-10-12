// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTextNode, type SmartElementNode } from "smartrte-core/foundation";
import { CanonicalEditorRuntime } from "./canonicalEditorRuntime.js";
import { MediaDragController, TOUCH_LONG_PRESS_MS, type Rect } from "./components/MediaDragController.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no layout, so the controller's `measure` seam lays the surface
 * out as a simple column: each top-level block is 40px tall with a 10px gap
 * (block i spans y = 50i .. 50i+40), the surface spans x 0..600.
 */
const ROW = 50;
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height, width, height });

const setup = (html = '<p>Alpha</p><img src="https://example.com/a.png" alt="Diagram" width="160" height="90"><p>Beta</p><p>Gamma</p>', props: Partial<React.ComponentProps<typeof MediaDragController>> = {}) => {
  const runtime = new CanonicalEditorRuntime({ initialValue: html });
  const surface = document.createElement("div");
  document.body.appendChild(surface);
  runtime.mount(surface);
  const measure = (element: Element): Rect => {
    if (element === surface) return rect(0, 0, 600, 1000);
    let top: Element = element;
    while (top.parentElement && top.parentElement !== surface) top = top.parentElement;
    const index = [...surface.children].indexOf(top);
    return rect(0, index * ROW, 600, 40);
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const reactRoot: Root = createRoot(host);
  const onMoved = vi.fn();
  const onDraggingChange = vi.fn();
  const render = (overrides: Partial<React.ComponentProps<typeof MediaDragController>> = {}) => act(() => reactRoot.render(
    <MediaDragController runtime={runtime} root={surface} enabled selectedNodeId={null} measure={measure} onMoved={onMoved} onDraggingChange={onDraggingChange} {...props} {...overrides} />,
  ));
  render();
  const blocks = () => runtime.editor.document.children.map((node) => isTextNode(node) ? "" : node.type === "block_image" ? "IMG" : (node.children || []).map((child) => isTextNode(child) ? child.text : "").join("")).filter(Boolean);
  const imageId = () => (runtime.editor.document.children.find((node) => !isTextNode(node) && node.type === "block_image") as SmartElementNode).id;
  const imageElement = () => runtime.surface.renderer!.mapping.nodeToDom(imageId()) as HTMLElement;
  const status = () => host.querySelector("[data-srte-media-drag-status]")?.textContent;
  return { runtime, surface, host, reactRoot, render, blocks, imageId, imageElement, status, onMoved, onDraggingChange };
};

/** jsdom has no PointerEvent: a MouseEvent carrying the pointer fields the controller reads. */
const pointer = (type: string, x: number, y: number, init: { pointerType?: string; pointerId?: number; button?: number } = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: init.button ?? 0 });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? "mouse" },
    isPrimary: { value: true },
  });
  return event;
};
const fire = (target: EventTarget, event: Event) => act(() => { target.dispatchEvent(event); });

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("MediaDragController: pointer", () => {
  it("treats 5px of movement as a click and 7px as a drag; dropping between Beta and Gamma moves the image once", () => {
    const { imageElement, blocks, onMoved, host, runtime, imageId } = setup();
    const image = imageElement();
    // Image is block 1 (y 50..90). 5px of wobble: still a click.
    fire(image, pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 103, 74));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    fire(window, pointer("pointerup", 103, 74));
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    // 7px: a drag.
    fire(image, pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 100, 77));
    expect(host.querySelector("[data-srte-media-drag-preview]")).not.toBeNull();
    expect(image.getAttribute("data-srte-drag-source")).toBe("true");
    // Between Beta (100..140) and Gamma (150..190).
    fire(window, pointer("pointermove", 100, 146));
    expect(host.querySelectorAll("[data-srte-media-drop-line]")).toHaveLength(1);
    fire(window, pointer("pointerup", 100, 146));
    expect(blocks()).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
    expect(onMoved).toHaveBeenCalledWith(imageId());
    expect(runtime.editor.selection.type).toBe("node");
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    expect(imageElement().hasAttribute("data-srte-drag-source")).toBe(false);
    // One undo step.
    expect(runtime.editor.undo()).toBe(true);
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
  });

  it("the handle starts a drag immediately; Esc cancels and restores the previous selection", () => {
    const { imageElement, imageId, host, blocks, render, runtime, status, onDraggingChange } = setup();
    runtime.editor.setSelection({ type: "text", anchor: { path: [0], offset: 2 }, head: { path: [0], offset: 2 } }, { source: "api" });
    render({ selectedNodeId: imageId() });
    const handle = host.querySelector<HTMLButtonElement>("[data-srte-media-drag-handle]")!;
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("aria-label")).toBe("Drag to move image");
    fire(handle, pointer("pointerdown", 10, 55));
    expect(imageElement().getAttribute("data-srte-drag-source")).toBe("true");
    expect(onDraggingChange).toHaveBeenLastCalledWith(true, imageId());
    fire(window, pointer("pointermove", 100, 146));
    fire(window, new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    expect(onDraggingChange).toHaveBeenLastCalledWith(false, imageId());
    expect(status()).toBe("Move cancelled.");
    fire(window, pointer("pointerup", 100, 146));
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    expect(runtime.editor.selection.head).toEqual({ path: [0], offset: 2 });
  });

  it("dropping on the original's own position, outside the editor, or after pointercancel changes nothing", () => {
    const { imageElement, blocks, onMoved } = setup();
    const drag = (x: number, y: number, end: "pointerup" | "pointercancel" = "pointerup") => {
      fire(imageElement(), pointer("pointerdown", 100, 70));
      fire(window, pointer("pointermove", 100, 80));
      fire(window, pointer("pointermove", x, y));
      fire(window, pointer(end, x, y));
    };
    drag(100, 60); // over itself
    drag(700, 146); // right of the surface
    drag(100, 146, "pointercancel");
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("ignores a second pointer and a non-primary button", () => {
    const { imageElement, host, blocks } = setup();
    fire(imageElement(), pointer("pointerdown", 100, 70, { button: 2 }));
    fire(window, pointer("pointermove", 100, 90));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    fire(window, pointer("pointerup", 100, 90));
    fire(imageElement(), pointer("pointerdown", 100, 70, { pointerId: 1 }));
    fire(window, pointer("pointermove", 100, 80, { pointerId: 1 }));
    fire(window, pointer("pointermove", 100, 10, { pointerId: 2 })); // a second finger
    fire(window, pointer("pointerup", 100, 10, { pointerId: 2 }));
    expect(host.querySelector("[data-srte-media-drag-preview]")).not.toBeNull();
    fire(window, pointer("pointermove", 100, 146, { pointerId: 1 }));
    fire(window, pointer("pointerup", 100, 146, { pointerId: 1 }));
    expect(blocks()).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
  });

  it("on touch, a press on the media drags only after a long press; moving first is a scroll", () => {
    vi.useFakeTimers();
    const { imageElement, host, blocks } = setup();
    fire(imageElement(), pointer("pointerdown", 100, 70, { pointerType: "touch" }));
    fire(window, pointer("pointermove", 100, 90, { pointerType: "touch" }));
    act(() => { vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 50); });
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    fire(window, pointer("pointerup", 100, 90, { pointerType: "touch" }));
    fire(imageElement(), pointer("pointerdown", 100, 70, { pointerType: "touch" }));
    act(() => { vi.advanceTimersByTime(TOUCH_LONG_PRESS_MS + 10); });
    expect(host.querySelector("[data-srte-media-drag-preview]")).not.toBeNull();
    fire(window, pointer("pointermove", 100, 146, { pointerType: "touch" }));
    fire(window, pointer("pointerup", 100, 146, { pointerType: "touch" }));
    expect(blocks()).toEqual(["Alpha", "Beta", "IMG", "Gamma"]);
  });

  it("undo during a drag cancels the drag first", () => {
    const { imageElement, host, status } = setup();
    fire(imageElement(), pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 100, 146));
    expect(host.querySelector("[data-srte-media-drag-preview]")).not.toBeNull();
    fire(window, new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    expect(status()).toBe("Move cancelled.");
  });

  it("cancels when the dragged node disappears mid-drag (e.g. a remote delete)", () => {
    const { imageElement, imageId, host, runtime, blocks } = setup();
    fire(imageElement(), pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 100, 80));
    const index = runtime.editor.document.children.findIndex((node) => !isTextNode(node) && node.id === imageId());
    act(() => runtime.executeOperations([{ type: "removeNode", pos: { path: [], offset: index }, node: runtime.editor.document.children[index] }], { focus: false }));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    fire(window, pointer("pointerup", 100, 146));
    expect(blocks()).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("MediaDragController: availability", () => {
  it("read-only: no handle, no dragging", () => {
    const { imageElement, imageId, host, render, blocks } = setup();
    render({ enabled: false, selectedNodeId: imageId() });
    expect(host.querySelector("[data-srte-media-drag-handle]")).toBeNull();
    fire(imageElement(), pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 100, 146));
    fire(window, pointer("pointerup", 100, 146));
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
  });

  it("a disabled reason (track changes) shows a disabled handle with that tooltip and blocks dragging", () => {
    const { imageElement, imageId, host, render, blocks } = setup();
    render({ disabledReason: "Turn off Show edits to move media.", selectedNodeId: imageId() });
    const handle = host.querySelector<HTMLButtonElement>("[data-srte-media-drag-handle]")!;
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(handle.title).toBe("Turn off Show edits to move media.");
    fire(handle, pointer("pointerdown", 10, 55));
    fire(imageElement(), pointer("pointerdown", 100, 70));
    fire(window, pointer("pointermove", 100, 146));
    fire(window, pointer("pointerup", 100, 146));
    expect(host.querySelector("[data-srte-media-drag-preview]")).toBeNull();
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
  });

  it("no handle for paragraphs or inline images", () => {
    const { host, render, runtime } = setup('<p>Alpha <img src="https://example.com/i.png" alt="inline"> text</p>');
    const paragraph = runtime.editor.document.children[0] as SmartElementNode;
    render({ selectedNodeId: paragraph.id });
    expect(host.querySelector("[data-srte-media-drag-handle]")).toBeNull();
    const inline = (paragraph.children || []).find((child) => !isTextNode(child) && child.type === "image") as SmartElementNode;
    render({ selectedNodeId: inline.id });
    expect(host.querySelector("[data-srte-media-drag-handle]")).toBeNull();
  });
});

describe("MediaDragController: keyboard", () => {
  const key = (target: Element, value: string) => fire(target, new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));

  it("Space picks up, arrows move through slots with announcements, Enter drops", () => {
    const { host, imageId, render, status, blocks, runtime } = setup();
    render({ selectedNodeId: imageId() });
    const handle = host.querySelector<HTMLButtonElement>("[data-srte-media-drag-handle]")!;
    act(() => handle.focus());
    key(handle, " ");
    expect(status()).toBe("Picked up image 'Diagram'. Use up and down arrows to choose where to drop, Enter to drop, Escape to cancel.");
    key(handle, "ArrowDown");
    expect(status()).toBe("Drop position: after 'Beta'.");
    expect(host.querySelectorAll("[data-srte-media-drop-line]")).toHaveLength(1);
    key(handle, "ArrowDown");
    expect(status()).toBe("Drop position: after 'Gamma'.");
    key(handle, "ArrowDown"); // already last: stays
    expect(status()).toBe("Drop position: after 'Gamma'.");
    key(handle, "ArrowUp");
    key(handle, "ArrowUp");
    expect(status()).toBe("Drop position: current position.");
    key(handle, "ArrowUp");
    expect(status()).toBe("Drop position: before 'Alpha'.");
    key(handle, "Enter");
    expect(blocks()).toEqual(["IMG", "Alpha", "Beta", "Gamma"]);
    expect(status()).toBe("Moved.");
    expect(runtime.editor.selection.type).toBe("node");
  });

  it("Esc cancels, and Enter on the current position is a cancel too", () => {
    const { host, imageId, render, status, blocks } = setup();
    render({ selectedNodeId: imageId() });
    const handle = host.querySelector<HTMLButtonElement>("[data-srte-media-drag-handle]")!;
    act(() => handle.focus());
    key(handle, "Enter");
    key(handle, "ArrowDown");
    key(handle, "Escape");
    expect(status()).toBe("Move cancelled.");
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
    key(handle, " ");
    key(handle, "Enter");
    expect(status()).toBe("Move cancelled.");
    expect(blocks()).toEqual(["Alpha", "IMG", "Beta", "Gamma"]);
  });

  it("announces container context for slots inside a table cell", () => {
    const { host, imageId, render, status } = setup('<p>Alpha</p><img src="https://example.com/a.png" alt="Diagram"><table><tbody><tr><td><p>Cell text</p></td></tr></tbody></table><p>End</p>');
    render({ selectedNodeId: imageId() });
    const handle = host.querySelector<HTMLButtonElement>("[data-srte-media-drag-handle]")!;
    act(() => handle.focus());
    key(handle, " ");
    const seen: string[] = [];
    for (let step = 0; step < 6; step += 1) { key(handle, "ArrowDown"); seen.push(status() || ""); }
    expect(seen).toContain("Drop position: after 'Cell text' in table cell.");
    expect(seen).toContain("Drop position: before 'Cell text' in table cell.");
  });
});
