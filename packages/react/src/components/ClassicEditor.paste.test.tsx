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

const PASTED_HTML = `<blockquote style="border: 0px solid lab(14.172 -1.55991 -3.26025); padding: 0px;"><p>Think of HIV as a stealth invader.</p></blockquote>`;

describe("ClassicEditor paste", () => {
  beforeAll(async () => {
    ClassicEditorComponent = (await import("./ClassicEditor.js")).ClassicEditor;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("strips an inline border/padding reset from a pasted blockquote", () => {
    document.execCommand = ((command: string, _show?: boolean, value?: string) => {
      if (command !== "insertHTML" || !value) return false;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(range.createContextualFragment(value));
      return true;
    }) as typeof document.execCommand;

    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={"<p><br></p>"} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector("p")!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const dataTransfer = {
      getData: (type: string) => (type === "text/html" ? PASTED_HTML : ""),
      files: [] as File[],
    };
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", { value: dataTransfer });
    act(() => editor.dispatchEvent(pasteEvent));

    const quote = editor.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote?.getAttribute("style")).toBeNull();
    expect(quote?.textContent).toBe("Think of HIV as a stealth invader.");
  });

  it("self-heals a blockquote's inline border/padding reset already present in the document", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host!);
      root.render(<ClassicEditorComponent value={PASTED_HTML} />);
    });
    const editor = host.querySelector('[contenteditable="true"]') as HTMLElement;

    const quote = editor.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote?.getAttribute("style")).toBeNull();
    expect(quote?.textContent).toBe("Think of HIV as a stealth invader.");
  });
});
