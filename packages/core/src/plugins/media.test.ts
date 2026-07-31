import { describe, expect, it } from "vitest";
import { createSmartEditor, mediaPlugin, paragraph, type SmartEditorState } from "../index.js";

const state = (): SmartEditorState => ({
  document: { type: "doc", children: [paragraph("before"), paragraph("after")] },
  selection: { type: "text", anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 2 } },
});

describe("media plugin", () => {
  it("inserts an image after the selected block and participates in history", () => {
    const editor = createSmartEditor({ state: state(), plugins: [mediaPlugin] });
    expect(editor.execute("image.insert", { src: "https://example.com/a.png", alt: "A" })).toBe(true);
    expect(editor.state.document.children[1]).toEqual({
      type: "image", src: "https://example.com/a.png", alt: "A",
    });
    expect(editor.state.selection).toEqual({ type: "node", path: [1] });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children).toHaveLength(2);
    expect(editor.redo()).toBe(true);
    expect(editor.state.document.children[1]).toMatchObject({ type: "image" });
  });

  it("supports explicit nested block paths and rejects invalid input", () => {
    const editor = createSmartEditor({ state: state(), plugins: [mediaPlugin] });
    expect(editor.canExecute("media.insert", { src: "", mediaType: "video" })).toBe(false);
    expect(editor.execute("media.insert", {
      src: "/clip.mp4",
      mediaType: "video",
      path: [1],
    })).toBe(true);
    expect(editor.state.document.children[1]).toMatchObject({
      type: "media", mediaType: "video", src: "/clip.mp4",
    });
  });

  it("inserts an atomic inline image without changing its paragraph", () => {
    const editor = createSmartEditor({ state: state(), plugins: [mediaPlugin] });
    expect(editor.execute("image.insert-inline", {
      src: "/inline.png",
      alt: "Inline",
    })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", text: "be" },
        { type: "inlineImage", src: "/inline.png", alt: "Inline" },
        { type: "text", text: "fore" },
      ],
    });
    expect(editor.state.selection).toEqual({
      type: "text",
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    });
    expect(editor.undo()).toBe(true);
    expect(editor.state.document.children[0]).toEqual(paragraph("before"));
  });

  it("updates and deletes inline images through model commands", () => {
    const editor = createSmartEditor({ state: state(), plugins: [mediaPlugin] });
    editor.execute("image.insert-inline", { src: "/inline.png" });
    expect(editor.execute("image.update-inline", {
      path: [0, 1],
      alt: "Updated",
      width: 240,
      height: 120,
    })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "be" }, {
        type: "inlineImage",
        alt: "Updated",
        width: 240,
        height: 120,
      }, { text: "fore" }],
    });
    expect(editor.execute("image.delete-inline", { path: [0, 1] })).toBe(true);
    expect(editor.state.document.children[0]).toMatchObject({
      children: [{ text: "be" }, { text: "fore" }],
    });
  });
});
