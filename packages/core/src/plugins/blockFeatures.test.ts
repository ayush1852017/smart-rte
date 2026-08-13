import { describe, expect, it } from "vitest";
import {
  alignmentPlugin,
  blockquotePlugin,
  blockTypePlugin,
  codeBlockPlugin,
  createSmartEditor,
  paragraph,
  type SmartEditorState,
} from "../legacy/index.js";

const state = (): SmartEditorState => ({
  document: {
    type: "doc",
    children: [paragraph("one"), paragraph("two"), paragraph("three")],
  },
  selection: {
    type: "text",
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [1, 0], offset: 3 },
  },
});

describe("block feature plugins", () => {
  it("exposes alignment and code blocks as editor commands", () => {
    const editor = createSmartEditor({
      state: state(),
      plugins: [alignmentPlugin, codeBlockPlugin],
    });
    expect(editor.execute("alignment.set", {
      paths: [[0], [1]],
      alignment: "center",
    })).toBe(true);
    expect(editor.state.document.children.slice(0, 2)).toMatchObject([
      { alignment: "center" },
      { alignment: "center" },
    ]);
    expect(editor.execute("code-block.toggle", {
      parentPath: [],
      blockIndexes: [0, 1],
    })).toBe(true);
    expect(editor.state.document.children.slice(0, 2)).toMatchObject([
      { type: "codeBlock", text: "one" },
      { type: "codeBlock", text: "two" },
    ]);
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      type: "paragraph",
      alignment: "center",
    });
  });

  it("changes heading levels without losing inline content", () => {
    const editor = createSmartEditor({ state: state(), plugins: [blockTypePlugin] });
    expect(editor.execute("block-type.set", {
      parentPath: [],
      blockIndexes: [0, 1],
      type: "heading",
      level: 2,
    })).toBe(true);
    expect(editor.state.document.children.slice(0, 2)).toMatchObject([
      { type: "heading", level: 2, children: [{ text: "one" }] },
      { type: "heading", level: 2, children: [{ text: "two" }] },
    ]);
    expect(editor.execute("block-type.set", {
      parentPath: [],
      blockIndexes: [1],
      type: "paragraph",
    })).toBe(true);
    expect(editor.state.document.children[1]).toEqual(paragraph("two"));
  });

  it("lets heading typography control size while preserving other inline marks", () => {
    const sized: SmartEditorState = {
      ...state(),
      document: {
        type: "doc",
        children: [{
          type: "paragraph",
          children: [{
            type: "text",
            text: "title",
            marks: [{ type: "fontSize", valuePx: 36 }, { type: "bold" }],
          }],
        }],
      },
    };
    const editor = createSmartEditor({ state: sized, plugins: [blockTypePlugin] });
    editor.execute("block-type.set", {
      parentPath: [], blockIndexes: [0], type: "heading", level: 2,
    });
    expect(editor.state.document.children[0]).toMatchObject({
      type: "heading",
      children: [{ text: "title", marks: [{ type: "bold" }] }],
    });
  });

  it("wraps contiguous blocks and unwraps blockquotes losslessly", () => {
    const editor = createSmartEditor({ state: state(), plugins: [blockquotePlugin] });
    expect(editor.execute("blockquote.toggle", {
      parentPath: [],
      blockIndexes: [0, 1],
    })).toBe(true);
    expect(editor.state.document.children).toMatchObject([
      { type: "blockquote", children: [{ type: "paragraph" }, { type: "paragraph" }] },
      { type: "paragraph", children: [{ text: "three" }] },
    ]);
    expect(editor.execute("blockquote.toggle", {
      parentPath: [],
      blockIndexes: [0],
    })).toBe(true);
    expect(editor.state.document.children.map((node) => node.type)).toEqual([
      "paragraph", "paragraph", "paragraph",
    ]);
  });

  it("rejects non-contiguous blockquote ranges", () => {
    const editor = createSmartEditor({ state: state(), plugins: [blockquotePlugin] });
    expect(editor.canExecute("blockquote.toggle", {
      parentPath: [],
      blockIndexes: [0, 2],
    })).toBe(false);
  });
});
