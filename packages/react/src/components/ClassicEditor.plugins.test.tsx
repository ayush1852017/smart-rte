// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { formulaPlugin } from "smartrte-core/legacy";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClassicEditorProps } from "./ClassicEditor.js";
import type { ReactEditorPlugin } from "../pluginRuntime.js";

type TestGlobal = typeof globalThis & { DOMMatrix?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as TestGlobal).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as TestGlobal).DOMMatrix = class DOMMatrix {} as unknown as typeof DOMMatrix;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ClassicEditorComponent: React.ComponentType<ClassicEditorProps>;

const renderEditor = (props: ClassicEditorProps = {}) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(<ClassicEditorComponent value="<p>Text</p>" {...props} />);
  });
  return host;
};

describe("ClassicEditor plugin configuration", () => {
  beforeAll(async () => {
    ClassicEditorComponent = (await import("./ClassicEditor.js")).ClassicEditor;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("hides disabled standard feature tools", () => {
    const editor = renderEditor({
      features: {
        basicFormatting: false,
        blockType: false,
        alignment: false,
        list: false,
        checklist: false,
        blockquote: false,
        codeBlock: false,
        table: false,
        media: false,
        formula: false,
      },
    });
    expect(editor.querySelector('[title="Bold"]')).toBeNull();
    expect(editor.querySelector('[title="Paragraph/Heading"]')).toBeNull();
    expect(editor.querySelector('[title="Bulleted list"]')).toBeNull();
    expect(editor.querySelector('[title="Checklist"]')).toBeNull();
    expect(editor.querySelector('[title="Blockquote"]')).toBeNull();
    expect(editor.querySelector('[title="Code block"]')).toBeNull();
    expect(editor.querySelector('[title="Text alignment"]')).toBeNull();
    expect(editor.querySelector('[title="Special characters"]')).not.toBeNull();
  });

  it("uses an exact custom plugin set as the toolbar authority", () => {
    const editor = renderEditor({ plugins: [formulaPlugin] });
    expect(editor.querySelector('[title="Insert formula"]')).not.toBeNull();
    expect(editor.querySelector('[title="Bold"]')).toBeNull();
    expect(editor.querySelector('[title="Table"]')).toBeNull();
    expect(editor.querySelector('[title="Bulleted list"]')).toBeNull();
  });

  it("uses the format runtime as the import/export authority", () => {
    const editor = renderEditor({
      formats: { pdf: false, docx: false, markdown: false },
    });
    expect(editor.querySelector('input[accept="application/pdf"]')).toBeNull();
    expect(editor.querySelector('input[accept=".docx"]')).toBeNull();
    expect(editor.querySelector('input[accept=".md,.markdown,text/markdown,text/plain"]')).toBeNull();
    expect(editor.querySelector('input[accept=".html,.htm,text/html"]')).toBeNull();
    expect(editor.querySelector('[aria-label="PDF (.pdf)"]')).toBeNull();
    expect(editor.querySelector('[aria-label="HTML (.html)"]')).not.toBeNull();
  });

  it("renders and executes a proprietary format adapter", async () => {
    const exportDocument = vi.fn(() => ({ kind: "handled" as const }));
    const editor = renderEditor({
      formatDefinitions: [{
        id: "clinical-json",
        label: "Clinical JSON",
        extension: "cjson",
        accept: ".cjson,application/json",
        canImport: false,
        canExport: true,
        exportDocument,
      }],
    });
    expect(editor.querySelector('[aria-label="Clinical JSON"]')).not.toBeNull();
    expect(editor.querySelector('[aria-label="HTML"]')).toBeNull();
    await act(async () => {
      (editor.querySelector('[aria-label="Clinical JSON"]') as HTMLButtonElement).click();
    });
    expect(exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ type: "doc" }),
      expect.objectContaining({ ownerDocument: document, hostWindow: window }),
    );
  });

  it("renders a custom plugin toolbar contribution", () => {
    const onTransaction = vi.fn();
    const plugin: ReactEditorPlugin = {
      id: "custom",
      onTransaction,
      commands: {
        "custom.run": {
          id: "custom.run",
          isEnabled: () => true,
          execute: (context) => ({
            id: "custom.run",
            source: "user",
            operations: [],
            selectionBefore: context.selection,
            selectionAfter: context.selection,
            addToHistory: true,
            timestamp: 1,
          }),
        },
      },
      react: {
        toolbar: [{
          id: "custom-button",
          commandId: "custom.run",
          label: "Custom action",
          icon: "C",
        }],
      },
    };
    const editor = renderEditor({ plugins: [plugin] });
    const button = editor.querySelector('[aria-label="Custom action"]') as HTMLButtonElement;
    expect(button.textContent).toBe("C");
    const text = editor.querySelector('[contenteditable="true"] p')?.firstChild;
    if (!text) throw new Error("Expected editor text.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => button.click());
    expect(onTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: "custom.run" }));
  });

  it("dispatches plugin shortcuts and context-menu actions", () => {
    const onTransaction = vi.fn();
    const plugin: ReactEditorPlugin = {
      id: "actions",
      onTransaction,
      commands: {
        "actions.run": {
          id: "actions.run",
          isEnabled: () => true,
          execute: (context) => ({
            id: "actions.run",
            source: "user",
            operations: [],
            selectionBefore: context.selection,
            selectionAfter: context.selection,
            addToHistory: true,
            timestamp: 1,
          }),
        },
      },
      react: {
        shortcuts: [{
          id: "actions-shortcut",
          commandId: "actions.run",
          key: "j",
          primary: true,
        }],
        contextMenu: [{
          id: "actions-context",
          commandId: "actions.run",
          label: "Run action",
          when: ({ target }) => target.tagName === "P",
        }],
      },
    };
    const editor = renderEditor({ plugins: [plugin] });
    const editable = editor.querySelector('[contenteditable="true"]') as HTMLElement;
    const paragraph = editable.querySelector("p")!;
    const text = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "j",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })));
    expect(onTransaction).toHaveBeenCalledTimes(1);

    const currentParagraph = editable.querySelector("p")!;
    act(() => currentParagraph.dispatchEvent(new MouseEvent("contextmenu", {
      clientX: 20,
      clientY: 20,
      bubbles: true,
      cancelable: true,
    })));
    const action = editor.querySelector('[aria-label="Plugin actions"] [role="menuitem"]') as HTMLButtonElement;
    expect(action.textContent).toContain("Run action");
    act(() => action.click());
    expect(onTransaction).toHaveBeenCalledTimes(2);
  });

  it("honors plugin toolbar visibility, enabled, active, order, and format contributions", () => {
    const command = {
      id: "state.run",
      isEnabled: () => true,
      execute: (context: any) => ({
        id: "state.run",
        source: "user" as const,
        operations: [],
        selectionBefore: context.selection,
        selectionAfter: context.selection,
        addToHistory: true,
        timestamp: 1,
      }),
    };
    const plugin: ReactEditorPlugin = {
      id: "stateful",
      commands: { "state.run": command },
      react: {
        toolbar: [
          { id: "hidden", commandId: "state.run", label: "Hidden", isVisible: () => false },
          { id: "disabled", commandId: "state.run", label: "Disabled", order: 20, isEnabled: () => false },
          { id: "active", commandId: "state.run", label: "Active", order: 10, isActive: () => true },
        ],
        formats: [{
          id: "state-json",
          label: "State JSON",
          extension: "json",
          canImport: false,
          canExport: true,
          exportDocument: () => ({ kind: "handled" }),
        }],
      },
    };
    const editor = renderEditor({ plugins: [plugin], formatDefinitions: [] });
    expect(editor.querySelector('[aria-label="Hidden"]')).toBeNull();
    expect((editor.querySelector('[aria-label="Disabled"]') as HTMLButtonElement).disabled).toBe(true);
    expect(editor.querySelector('[aria-label="Active"]')?.getAttribute("aria-pressed")).toBe("true");
    const labels = Array.from(editor.querySelectorAll(".srte-tool-button"))
      .map((button) => button.getAttribute("aria-label"));
    expect(labels.indexOf("Active")).toBeLessThan(labels.indexOf("Disabled"));
    expect(editor.querySelector('[aria-label="State JSON"]')).not.toBeNull();
  });
});
