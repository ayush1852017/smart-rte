// @vitest-environment jsdom
//
// Proves the "headless facade" claim from Phase 9 SS2.5: CanonicalEditorRuntime
// / SmartEditorHandle is a real, usable editing engine with zero React
// dependency. This file must never import "react" or "react-dom" - that
// absence, combined with a fully working editing session below, is the
// concrete evidence for the claim (not just the fact that the runtime's own
// source file happens to have no React imports).
import { afterEach, describe, expect, it } from "vitest";
import type { PersistedEditorDocument } from "smartrte-core/foundation";
import { createCanonicalEditorRuntime, type CanonicalEditorRuntime } from "./canonicalEditorRuntime.js";

const docWithText = (text: string): PersistedEditorDocument["document"] => (
  { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p0", children: [{ type: "text", text }] }] }
);

describe("Phase 9 SS2.5 headless facade smoke test (no React in this file's import graph)", () => {
  let runtime: CanonicalEditorRuntime | null = null;

  afterEach(() => {
    runtime?.unmount();
    runtime = null;
  });

  it("mounts to a plain DOM element, edits, and unmounts without any framework", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>hello</p>" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    runtime.mount(root);
    expect(root.textContent).toBe("hello");

    const paragraph = runtime.editor.document.children[0];
    runtime.editor.transact((builder) => {
      builder.operations.push({
        type: "replaceNode",
        pos: { path: [], offset: 0 },
        before: paragraph as never,
        after: { ...paragraph, children: [{ type: "text", text: "hello world" }] } as never,
      });
    }, { addToHistory: true });

    expect(root.textContent).toBe("hello world");
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "hello world" }] });

    runtime.unmount();
    expect(root.childNodes.length).toBe(0);
    root.remove();
  });

  it("supports getValue/replaceValue/isDirty/markSaved/getRevision without a mounted DOM", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>a</p>" });
    expect(runtime.isDirty()).toBe(false);
    expect(runtime.getRevision()).toBe(0);

    const replacement: PersistedEditorDocument = { schemaVersion: runtime.getValue().schemaVersion, revision: 1, document: docWithText("b") };
    runtime.replaceValue(replacement);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "b" }] });
    expect(runtime.isDirty()).toBe(true);

    runtime.markSaved(runtime.getRevision());
    expect(runtime.isDirty()).toBe(false);
  });

  it("round-trips a checkpoint without a mounted DOM", () => {
    runtime = createCanonicalEditorRuntime({ initialValue: "<p>checkpoint me</p>" });
    const checkpoint = runtime.createCheckpoint();

    const replacement: PersistedEditorDocument = { schemaVersion: runtime.getValue().schemaVersion, revision: 0, document: docWithText("changed") };
    runtime.replaceValue(replacement);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "changed" }] });

    runtime.restoreCheckpoint(checkpoint);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "checkpoint me" }] });
  });
});
