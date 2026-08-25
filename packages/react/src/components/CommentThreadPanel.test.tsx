// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentThread } from "smartrte-core/foundation";
import { CommentThreadPanel, type CommentThreadPanelProps } from "./CommentThreadPanel.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const thread = (id: string, resolved = false): CommentThread => ({
  id, resolved, range: { startId: "p1", startOffset: 0, endId: "p1", endOffset: 5 },
  replies: [{ id: `${id}-r1`, authorId: "alice", text: `comment ${id}`, createdAt: 1000 }],
});

const renderPanel = (overrides: Partial<CommentThreadPanelProps> = {}) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const props: CommentThreadPanelProps = {
    open: true,
    onClose: vi.fn(),
    threads: [],
    activeThreadId: null,
    onSelectThread: vi.fn(),
    pendingRange: null,
    onCreateThread: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
    busyThreadId: null,
    ...overrides,
  };
  act(() => { root!.render(<CommentThreadPanel {...props} />); });
  return props;
};

const click = (selector: string) => act(() => (document.querySelector(selector) as HTMLButtonElement).click());

describe("CommentThreadPanel", () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("shows nothing when closed", () => {
    renderPanel({ open: false });
    expect(document.querySelector('[data-srte-comment-panel="true"]')).toBeNull();
  });

  it("lists unresolved threads by default and hides resolved ones until 'Show resolved' is checked", () => {
    renderPanel({ threads: [thread("open"), thread("closed", true)] });
    expect(document.querySelector('[data-srte-comment-thread="open"]')).not.toBeNull();
    expect(document.querySelector('[data-srte-comment-thread="closed"]')).toBeNull();

    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => checkbox.click());
    expect(document.querySelector('[data-srte-comment-thread="closed"]')).not.toBeNull();
  });

  it("renders a compose box when a pendingRange is set, and submits the typed text via onCreateThread", () => {
    const props = renderPanel({ pendingRange: { startId: "p1", startOffset: 0, endId: "p1", endOffset: 5 } });
    const textarea = document.querySelector('[data-srte-comment-compose="true"] textarea') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Looks good");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click('[data-srte-comment-compose-submit="true"]');
    expect(props.onCreateThread).toHaveBeenCalledWith("Looks good");
  });

  it("replying to a thread calls onReply with its id and the typed text", () => {
    const props = renderPanel({ threads: [thread("t1")] });
    const input = document.querySelector('[data-srte-comment-thread="t1"] input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, "agreed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click('[data-srte-comment-reply-submit="t1"]');
    expect(props.onReply).toHaveBeenCalledWith("t1", "agreed");
  });

  it("resolving toggles via onResolve with the opposite of the thread's current state", () => {
    const props = renderPanel({ threads: [thread("t1")] });
    click('[data-srte-comment-resolve="t1"]');
    expect(props.onResolve).toHaveBeenCalledWith("t1", true);
  });

  it("reopening a resolved thread calls onResolve(id, false)", () => {
    const props = renderPanel({ threads: [thread("t1", true)] });
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => checkbox.click());
    click('[data-srte-comment-resolve="t1"]');
    expect(props.onResolve).toHaveBeenCalledWith("t1", false);
  });

  it("deleting a thread calls onDelete with its id", () => {
    const props = renderPanel({ threads: [thread("t1")] });
    click('[data-srte-comment-delete="t1"]');
    expect(props.onDelete).toHaveBeenCalledWith("t1");
  });

  it("clicking a thread row calls onSelectThread with its id", () => {
    const props = renderPanel({ threads: [thread("t1")] });
    act(() => (document.querySelector('[data-srte-comment-thread="t1"]') as HTMLDivElement).click());
    expect(props.onSelectThread).toHaveBeenCalledWith("t1");
  });
});
