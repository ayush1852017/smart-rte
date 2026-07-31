import { describe, expect, it, vi } from "vitest";
import {
  createSmartEditor,
  paragraph,
  type SmartCommand,
  type SmartEditorState,
  type SmartRtePlugin,
  type SmartTransaction,
} from "./index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("hello")] },
  selection: {
    type: "text",
    anchor: { path: [0, 0], offset: 5 },
    focus: { path: [0, 0], offset: 5 },
  },
});

const appendText: SmartCommand<string> = {
  id: "text.append",
  isEnabled: (_context, input) => Boolean(input),
  execute: (context, input) => ({
    id: "text.append",
    source: "user",
    operations: [{ type: "replaceText", path: [0, 0], start: 5, end: 5, text: input || "" }],
    selectionBefore: context.selection,
    addToHistory: true,
    timestamp: 1,
  }),
};

const textPlugin: SmartRtePlugin = {
  id: "text",
  commands: { "text.append": appendText },
};

describe("SmartEditor runtime", () => {
  it("orders plugins by dependencies independent of registration order", () => {
    const editor = createSmartEditor({
      state: state(),
      plugins: [
        { id: "dependent", dependencies: ["base"] },
        { id: "base" },
      ],
    });
    expect(editor.pluginIds).toEqual(["base", "dependent"]);
  });

  it("rejects missing, circular, duplicate plugin and command registrations", () => {
    expect(() => createSmartEditor({
      state: state(),
      plugins: [{ id: "dependent", dependencies: ["missing"] }],
    })).toThrow("missing plugin");

    expect(() => createSmartEditor({
      state: state(),
      plugins: [
        { id: "one", dependencies: ["two"] },
        { id: "two", dependencies: ["one"] },
      ],
    })).toThrow("Circular");

    expect(() => createSmartEditor({
      state: state(),
      plugins: [{ id: "same" }, { id: "same" }],
    })).toThrow("Duplicate plugin");

    expect(() => createSmartEditor({
      state: state(),
      plugins: [
        { id: "one", commands: { duplicate: appendText } },
        { id: "two", commands: { duplicate: appendText } },
      ],
    })).toThrow("Duplicate command");
  });

  it("executes registered commands and exposes enablement", () => {
    const editor = createSmartEditor({ state: state(), plugins: [textPlugin] });
    expect(editor.canExecute("text.append", "!")).toBe(true);
    expect(editor.canExecute("text.append", "")).toBe(false);
    expect(editor.canExecute("missing")).toBe(false);
    expect(editor.execute("text.append", "!")).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("hello!"));
  });

  it("runs plugin normalizers inside the recorded transaction", () => {
    const plugin: SmartRtePlugin = {
      ...textPlugin,
      normalizers: [(document) => {
        const block = document.children[0];
        if (block.type !== "paragraph") return document;
        const text = block.children[0].text;
        const upper = text.toUpperCase();
        return text === upper
          ? document
          : { ...document, children: [{ ...block, children: [{ ...block.children[0], text: upper }] }] };
      }],
    };
    const editor = createSmartEditor({ state: state(), plugins: [plugin] });
    editor.execute("text.append", "!");
    expect(editor.state.document.children[0]).toEqual(paragraph("HELLO!"));
    expect(editor.undo()).toBe(true);
    expect(editor.state).toEqual(state());
    expect(editor.redo()).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("HELLO!"));
  });

  it("rejects non-converging plugin normalization", () => {
    const plugin: SmartRtePlugin = {
      id: "oscillating",
      normalizers: [(document) => {
        const block = document.children[0];
        if (block.type !== "paragraph") return document;
        const text = block.children[0].text;
        return {
          ...document,
          children: [{ ...block, children: [{ ...block.children[0], text: text === "a" ? "b" : "a" }] }],
        };
      }],
    };
    const editor = createSmartEditor({
      state: { ...state(), document: { type: "doc", children: [paragraph("a")] } },
      plugins: [plugin],
    });
    const tx: SmartTransaction = {
      id: "trigger",
      source: "api",
      operations: [],
      selectionBefore: editor.state.selection,
      addToHistory: false,
      timestamp: 1,
    };
    expect(() => editor.dispatch(tx)).toThrow("fixed point");
  });

  it("supports subscriptions and unsubscription", () => {
    const editor = createSmartEditor({ state: state(), plugins: [textPlugin] });
    const listener = vi.fn();
    const unsubscribe = editor.subscribe(listener);
    editor.execute("text.append", "!");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    editor.undo();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("blocks user commands and history while read-only but permits API hydration", () => {
    const editor = createSmartEditor({ state: state(), plugins: [textPlugin], readOnly: true });
    expect(editor.canExecute("text.append", "!")).toBe(false);
    expect(editor.execute("text.append", "!")).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.dispatch({
      id: "hydrate",
      source: "api",
      operations: [{ type: "replaceNode", path: [0], node: paragraph("hydrated") }],
      selectionBefore: editor.state.selection,
      addToHistory: false,
      timestamp: 1,
    })).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("hydrated"));
  });

  it("notifies plugin transaction hooks", () => {
    const onTransaction = vi.fn();
    const editor = createSmartEditor({
      state: state(),
      plugins: [{ ...textPlugin, onTransaction }],
    });
    editor.execute("text.append", "!");
    expect(onTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: "text.append" }));
  });

  it("composes plugin schema normalization and validation into editor state", () => {
    const editor = createSmartEditor({
      state: state(),
      plugins: [{
        id: "uppercase-schema",
        commands: { "text.append": appendText },
        schema: {
          normalize: (document) => {
            const first = document.children[0];
            if (first.type !== "paragraph") return document;
            const text = first.children[0].text;
            return text === text.toUpperCase()
              ? document
              : {
                ...document,
                children: [{
                  ...first,
                  children: [{ ...first.children[0], text: text.toUpperCase() }],
                }],
              };
          },
          validate: (document) => {
            const first = document.children[0];
            return first.type === "paragraph" && first.children[0].text === first.children[0].text.toUpperCase()
              ? []
              : [{ path: [0], code: "not-uppercase", message: "Text must be uppercase." }];
          },
        },
      }],
    });

    expect(editor.state.document.children[0]).toEqual(paragraph("HELLO"));
    expect(editor.execute("text.append", "!")).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("HELLO!"));
  });
});
