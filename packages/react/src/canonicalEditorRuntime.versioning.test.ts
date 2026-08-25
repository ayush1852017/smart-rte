// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalEditorRuntime, type CanonicalEditorRuntime } from "./canonicalEditorRuntime.js";

describe("CanonicalEditorRuntime versioning (Phase 12a)", () => {
  let runtime: CanonicalEditorRuntime | null = null;

  afterEach(() => {
    runtime?.unmount();
    runtime = null;
  });

  it("saveVersion captures current content without touching the undo stack or history", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>hello</p>" });
    const undoLengthBefore = runtime.editor.history.undo.length;
    const version = runtime.saveVersion({ label: "First draft", authorId: "author-1" });

    expect(version.envelope.document.children[0]).toMatchObject({ children: [{ text: "hello" }] });
    expect(version.label).toBe("First draft");
    expect(version.authorId).toBe("author-1");
    expect(typeof version.id).toBe("string");
    expect(version.id.length).toBeGreaterThan(0);
    expect(typeof version.createdAt).toBe("number");
    expect(runtime.editor.history.undo.length).toBe(undoLengthBefore);
  });

  it("saveVersion omits label/authorId entirely when not provided, rather than storing them as undefined", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>hello</p>" });
    const version = runtime.saveVersion();
    expect("label" in version).toBe(false);
    expect("authorId" in version).toBe(false);
  });

  it("restoreVersion restores the saved content", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>original</p>" });
    const version = runtime.saveVersion();

    runtime.replaceValue({ ...runtime.getValue(), document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "edited" }] }] } });
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "edited" }] });

    runtime.restoreVersion(version);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "original" }] });
  });

  it("restoreVersion always re-stamps revision to current+1, never reusing the version's own stored revision", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>a</p>" });
    const version = runtime.saveVersion();
    expect(version.envelope.revision).toBe(0);

    // Advance the live revision several steps past what the saved version recorded.
    runtime.replaceValue({ ...runtime.getValue(), revision: 5, document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "b" }] }] } });
    expect(runtime.getRevision()).toBe(5);

    runtime.restoreVersion(version);
    // Must be current(5)+1, never the version's own stored revision (0) -
    // reusing it would roll the live counter backward.
    expect(runtime.getRevision()).toBe(6);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "a" }] });
  });

  it("restoreVersion is not undoable, matching restoreCheckpoint's existing contract", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>original</p>" });
    const version = runtime.saveVersion();
    runtime.replaceValue({ ...runtime.getValue(), document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "edited" }] }] } });

    const undoLengthBeforeRestore = runtime.editor.history.undo.length;
    runtime.restoreVersion(version);
    expect(runtime.editor.history.undo.length).toBe(undoLengthBeforeRestore);
  });

  it("a normal edit still works after restoreVersion - the revision re-stamp doesn't wedge the transaction pipeline", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>original</p>" });
    const version = runtime.saveVersion();
    runtime.replaceValue({ ...runtime.getValue(), document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text: "edited" }] }] } });
    runtime.restoreVersion(version);

    const paragraph = runtime.editor.document.children[0];
    expect(() => runtime!.editor.transact((builder) => {
      builder.operations.push({
        type: "replaceNode",
        pos: { path: [], offset: 0 },
        before: paragraph as never,
        after: { ...paragraph, children: [{ type: "text", text: "original edited again" }] } as never,
      });
    }, { addToHistory: true })).not.toThrow();
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "original edited again" }] });
  });
});
