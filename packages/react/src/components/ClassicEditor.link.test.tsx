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

const renderEditor = (value = "<p>Text</p>") => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<ClassicEditorComponent value={value} />);
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

  it("edits link text, destination, and new-tab settings", () => {
    renderEditor('<p><a href="https://old.example">Old link</a></p>');
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const anchor = editor.querySelector("a") as HTMLAnchorElement;
    act(() => anchor.click());

    const textInput = document.querySelector("[data-srte-link-text-input]") as HTMLInputElement;
    const hrefInput = document.querySelector("[data-srte-link-href-input]") as HTMLInputElement;
    const newTabInput = document.querySelector("[data-srte-link-new-tab-input]") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(textInput, "New link");
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(hrefInput, "new.example");
      hrefInput.dispatchEvent(new Event("input", { bubbles: true }));
      newTabInput.click();
    });
    const update = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Update") as HTMLButtonElement;
    act(() => update.click());

    expect(anchor.textContent).toBe("New link");
    expect(anchor.getAttribute("href")).toBe("https://new.example");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toContain("noopener");
    expect(anchor.rel).toContain("noreferrer");
  });
});
