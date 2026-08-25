// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmartDocument, StructuralSuggestion } from "smartrte-core/foundation";
import { SuggestionPanel, type SuggestionPanelProps } from "./SuggestionPanel.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const docWithInlineSuggestion = (id: string, kind: "insert" | "delete", text: string, authorId = "alice"): SmartDocument => ({
  type: "doc", id: "doc", children: [{
    type: "paragraph", id: "p", children: [{ type: "text", text, marks: [{ type: "suggestion", attrs: { id, authorId, kind, createdAt: 1000 } }] }],
  }],
});
const emptyDoc: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [] }] };
const structural = (id: string, authorId = "alice"): StructuralSuggestion => ({ id, authorId, kind: "removeNode", range: { startId: "target", endId: "target" }, createdAt: 2000 });

const renderPanel = (overrides: Partial<SuggestionPanelProps> = {}) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const props: SuggestionPanelProps = {
    open: true,
    onClose: vi.fn(),
    document: emptyDoc,
    structuralSuggestions: [],
    activeId: null,
    onSelect: vi.fn(),
    pendingInsert: false,
    onSubmitInsert: vi.fn(),
    onAcceptInline: vi.fn(),
    onRejectInline: vi.fn(),
    onAcceptStructural: vi.fn(),
    onRejectStructural: vi.fn(),
    busyId: null,
    ...overrides,
  };
  act(() => { root!.render(<SuggestionPanel {...props} />); });
  return props;
};

const click = (selector: string) => act(() => (document.querySelector(selector) as HTMLButtonElement).click());

describe("SuggestionPanel", () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("shows nothing when closed", () => {
    renderPanel({ open: false });
    expect(document.querySelector('[data-srte-suggestion-panel="true"]')).toBeNull();
  });

  it("lists an inline suggestion discovered from the document's own marks", () => {
    renderPanel({ document: docWithInlineSuggestion("s1", "delete", "hello") });
    const entry = document.querySelector('[data-srte-suggestion-entry="s1"]');
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toContain("alice suggests deleting");
    expect(entry?.textContent).toContain("hello");
  });

  it("lists a structural suggestion from the explicit prop", () => {
    renderPanel({ structuralSuggestions: [structural("s2", "bob")] });
    const entry = document.querySelector('[data-srte-suggestion-entry="s2"]');
    expect(entry?.textContent).toContain("bob suggests removing this block");
  });

  it("shows a compose box only when pendingInsert is true, and submits the typed text", () => {
    const props = renderPanel({ pendingInsert: true });
    const textarea = document.querySelector('[data-srte-suggestion-compose="true"] textarea') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "new text");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click('[data-srte-suggestion-compose-submit="true"]');
    expect(props.onSubmitInsert).toHaveBeenCalledWith("new text");
  });

  it("does not render a compose box when pendingInsert is false", () => {
    renderPanel({ pendingInsert: false });
    expect(document.querySelector('[data-srte-suggestion-compose="true"]')).toBeNull();
  });

  it("accepting/rejecting an inline suggestion calls the right callback with its id", () => {
    const props = renderPanel({ document: docWithInlineSuggestion("s1", "insert", "hi") });
    click('[data-srte-suggestion-accept="s1"]');
    expect(props.onAcceptInline).toHaveBeenCalledWith("s1");
    click('[data-srte-suggestion-reject="s1"]');
    expect(props.onRejectInline).toHaveBeenCalledWith("s1");
  });

  it("accepting/rejecting a structural suggestion calls the right callback with the suggestion object", () => {
    const suggestion = structural("s2");
    const props = renderPanel({ structuralSuggestions: [suggestion] });
    click('[data-srte-suggestion-accept="s2"]');
    expect(props.onAcceptStructural).toHaveBeenCalledWith(suggestion);
    click('[data-srte-suggestion-reject="s2"]');
    expect(props.onRejectStructural).toHaveBeenCalledWith(suggestion);
  });

  it("clicking an entry calls onSelect with its id", () => {
    const props = renderPanel({ document: docWithInlineSuggestion("s1", "delete", "hello") });
    act(() => (document.querySelector('[data-srte-suggestion-entry="s1"]') as HTMLDivElement).click());
    expect(props.onSelect).toHaveBeenCalledWith("s1");
  });

  it("shows an empty state when there are no pending suggestions", () => {
    renderPanel();
    expect(document.body.textContent).toContain("No pending suggestions.");
  });
});
