// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type TestGlobal = typeof globalThis & { DOMMatrix?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as TestGlobal).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as TestGlobal).DOMMatrix = class DOMMatrix {} as unknown as typeof DOMMatrix;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ClassicEditorComponent: React.ComponentType<{ value?: string }>;

const renderEditor = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<ClassicEditorComponent value="<p>Text</p>" />);
  });
};

describe("ClassicEditor link UI", () => {
  beforeAll(async () => {
    ClassicEditorComponent = (await import("./ClassicEditor.js")).ClassicEditor;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("opens the link popover with Ctrl/Cmd+K", () => {
    renderEditor();
    const editor = document.querySelector("[contenteditable=\"true\"]") as HTMLElement;

    act(() => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    expect(document.querySelector("[data-srte-link-popover]")).not.toBeNull();
  });
});
