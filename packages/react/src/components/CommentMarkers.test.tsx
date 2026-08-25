// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopeIndex, foundationSchema } from "smartrte-core/foundation";
import type { CommentThread, ModelDomMapping, PositionLookup, SmartDocument } from "smartrte-core/foundation";
import { CommentMarkers } from "./CommentMarkers.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom performs no real layout, so it neither implements ResizeObserver
// nor Range.getClientRects()/getBoundingClientRect() - stub both narrowly
// here (not in global test setup) so CommentMarkers' live-remeasure effect
// can run without throwing; real rect geometry is only meaningfully
// verified in the Playwright e2e suite, exactly like TableResizeHandles/
// MediaOverlay's own ResizeObserver-driven measurement.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as typeof globalThis & { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.Range.prototype.getClientRects) {
  window.Range.prototype.getClientRects = function () { return [] as unknown as DOMRectList; };
}
if (!window.Range.prototype.getBoundingClientRect) {
  window.Range.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let container: HTMLDivElement | null = null;

const thread = (id: string, resolved = false): CommentThread => ({
  id, resolved, range: { startId: "p1", startOffset: 0, endId: "p1", endOffset: 5 },
  replies: [{ id: `${id}-r1`, authorId: "a", text: "hi", createdAt: 1 }],
});

// A fake ModelDomMapping backed by one real text node - jsdom performs no
// real layout, so getClientRects() always returns an empty list; every
// assertion here relies on CommentMarkers' getBoundingClientRect() fallback
// for the badge anchor rather than on any real rect geometry.
const setup = () => {
  const document_: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "hello world" }] }] };
  const positions: PositionLookup = createScopeIndex().positions(document_, foundationSchema);
  container = window.document.createElement("div");
  container.innerHTML = "<p>hello world</p>";
  window.document.body.appendChild(container);
  const textNode = container.querySelector("p")!.firstChild!;
  const mapping: ModelDomMapping = {
    nodeToDom: () => null,
    domToNode: () => null,
    posToDom: (pos) => ({ node: textNode, offset: pos.offset }),
    domToPos: () => null,
    isEditorUiNode: () => false,
    rebuild: () => {},
  };
  return { positions, mapping };
};

const renderMarkers = (threads: CommentThread[], activeThreadId: string | null = null) => {
  const { positions, mapping } = setup();
  host = window.document.createElement("div");
  window.document.body.appendChild(host);
  root = createRoot(host);
  const onSelectThread = vi.fn();
  act(() => {
    root!.render(<CommentMarkers positions={positions} mapping={mapping} containerElement={container!} threads={threads} activeThreadId={activeThreadId} onSelectThread={onSelectThread} />);
  });
  return { onSelectThread };
};

describe("CommentMarkers", () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    container?.remove();
    root = null;
    host = null;
    container = null;
  });

  it("renders a badge for a thread whose range resolves", () => {
    renderMarkers([thread("t1")]);
    const badge = window.document.querySelector('[data-srte-comment-badge="t1"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("1");
  });

  it("renders no badge for a thread anchored to a node id that no longer exists in the document", () => {
    renderMarkers([{ ...thread("gone"), range: { startId: "does-not-exist", endId: "does-not-exist" } }]);
    expect(window.document.querySelector('[data-srte-comment-badge="gone"]')).toBeNull();
  });

  it("clicking a badge calls onSelectThread with that thread's id", () => {
    const { onSelectThread } = renderMarkers([thread("t1")]);
    act(() => (window.document.querySelector('[data-srte-comment-badge="t1"]') as HTMLButtonElement).click());
    expect(onSelectThread).toHaveBeenCalledWith("t1");
  });

  it("renders one badge per resolvable thread", () => {
    renderMarkers([thread("t1"), thread("t2")]);
    expect(window.document.querySelector('[data-srte-comment-badge="t1"]')).not.toBeNull();
    expect(window.document.querySelector('[data-srte-comment-badge="t2"]')).not.toBeNull();
  });

  it("renders nothing when there are no threads", () => {
    renderMarkers([]);
    expect(window.document.querySelectorAll('[data-srte-comment-badge]').length).toBe(0);
  });
});
