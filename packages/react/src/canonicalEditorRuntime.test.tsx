// @vitest-environment jsdom
import React, { StrictMode, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { foundationSchema, parseCanonicalListHtml } from "smartrte-core/foundation";
import { canonicalAuthorityFlag } from "./canonicalAuthorityFlag.js";
import { CanonicalEditorRuntime, type SmartEditorHandle } from "./canonicalEditorRuntime.js";
import { CanonicalAuthorityEditor } from "./components/CanonicalAuthorityEditor.js";
import { ClassicEditor } from "./components/ClassicEditorAuthority.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  canonicalAuthorityFlag.reset();
  document.body.replaceChildren();
});

describe("canonical authority lifecycle", () => {
  it("resolves direct, document, tenant, and global rollback overrides deterministically", () => {
    canonicalAuthorityFlag.setGlobal(true);
    canonicalAuthorityFlag.setTenant("tenant", false);
    canonicalAuthorityFlag.setDocument("doc", true);
    expect(canonicalAuthorityFlag.enabled({ tenantId: "tenant", documentId: "doc" })).toBe(true);
    expect(canonicalAuthorityFlag.enabled({ tenantId: "tenant" })).toBe(false);
    expect(canonicalAuthorityFlag.enabled({ tenantId: "other" })).toBe(true);
    expect(canonicalAuthorityFlag.enabled({ documentId: "doc" }, false)).toBe(false);
  });

  it("uses one retained runtime through StrictMode effect replay and prop changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    const seen: CanonicalEditorRuntime[] = [];
    const changes = vi.fn();
    const render = (placeholder: string) => <StrictMode><CanonicalAuthorityEditor
      defaultValue="<p>start</p>"
      placeholder={placeholder}
      onChange={changes}
      onRuntime={(runtime) => seen.push(runtime)}
    /></StrictMode>;
    act(() => reactRoot.render(render("first")));
    const retained = seen.at(-1)!;
    expect(host.querySelectorAll('[contenteditable="true"] > p')).toHaveLength(1);
    act(() => reactRoot.render(render("second")));
    expect(seen.at(-1)).toBe(retained);
    expect(retained.editor.document.children[0]).toMatchObject({ children: [{ text: "start" }] });
    act(() => retained.editor.typeText("!", { timestamp: 1 }));
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, documentChanged: true }));
    act(() => reactRoot.unmount());
    expect(retained.surface.pipeline).toBeNull();
    expect(retained.surface.renderer).toBeNull();
  });

  it("supports explicit replacement, revision dirtiness, and crash checkpoints", () => {
    const runtime = new CanonicalEditorRuntime({ initialValue: "<p>one</p>" });
    const initial = runtime.getRevision();
    runtime.editor.typeText("!", { timestamp: 1 });
    expect(runtime.isDirty()).toBe(true);
    runtime.markSaved(runtime.getRevision());
    expect(runtime.isDirty()).toBe(false);
    const checkpoint = runtime.createCheckpoint();
    const replacement = {
      schemaVersion: foundationSchema.version,
      revision: 9,
      document: parseCanonicalListHtml('<p data-smart-id="replacement">replacement</p>'),
    };
    runtime.replaceValue(replacement);
    expect(runtime.getRevision()).toBe(9);
    expect(runtime.getValue().document.children[0]).toMatchObject({ children: [{ text: "replacement" }] });
    runtime.restoreCheckpoint(checkpoint);
    expect(runtime.getRevision()).toBe(initial + 1);
    expect(runtime.isDirty()).toBe(false);
  });

  it("exposes the imperative host contract", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    const handle = createRef<SmartEditorHandle>();
    act(() => reactRoot.render(<CanonicalAuthorityEditor ref={handle} defaultValue="<p>host</p>" />));
    expect(handle.current?.getValue().document.children[0]).toMatchObject({ children: [{ text: "host" }] });
    expect(handle.current?.createCheckpoint().selection.type).toBe("text");
    act(() => reactRoot.unmount());
  });

  it("flips to the rollback renderer without losing the latest canonical document", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    let runtime: CanonicalEditorRuntime | null = null;
    canonicalAuthorityFlag.setGlobal(true);
    act(() => reactRoot.render(<ClassicEditor defaultValue="<p>safe</p>" onRuntime={(value) => { runtime = value; }} />));
    expect(host.querySelector('[data-smart-authority="canonical"]')).not.toBeNull();
    act(() => runtime!.editor.typeText("!", { timestamp: 1 }));
    act(() => canonicalAuthorityFlag.setGlobal(false));
    expect(host.querySelector('[data-smart-authority="canonical"]')).toBeNull();
    expect(host.querySelector('[contenteditable="true"]')?.textContent).toContain("!safe");
    act(() => reactRoot.unmount());
  });
});
