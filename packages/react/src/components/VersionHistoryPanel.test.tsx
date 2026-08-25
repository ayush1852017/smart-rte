// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentVersion } from "smartrte-core/foundation";
import { VersionHistoryPanel } from "./VersionHistoryPanel.js";
import type { VersionListEntry, VersionProvider } from "../versionProvider.js";
import type { CanonicalEditorRuntime } from "../canonicalEditorRuntime.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const docOf = (text: string) => ({ type: "doc" as const, id: "doc", children: [{ type: "paragraph" as const, id: "p1", children: [{ type: "text" as const, text }] }] });

const fakeVersion = (id: string, text: string, label?: string): DocumentVersion => ({
  id, createdAt: Date.parse(`2026-08-2${id}T00:00:00Z`), ...(label ? { label } : {}),
  envelope: { schemaVersion: 1, revision: 0, document: docOf(text) },
});

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const renderPanel = (overrides: { versionProvider?: Partial<VersionProvider>; runtime?: Partial<CanonicalEditorRuntime> } = {}) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  const runtime = {
    saveVersion: vi.fn(() => fakeVersion("9", "current content", "auto-saved")),
    restoreVersion: vi.fn(),
    ...overrides.runtime,
  } as unknown as CanonicalEditorRuntime;

  const versionProvider = {
    save: vi.fn(async (version: DocumentVersion) => ({ id: version.id, createdAt: version.createdAt, ...(version.label ? { label: version.label } : {}) })),
    list: vi.fn(async () => [] as VersionListEntry[]),
    load: vi.fn(async (id: string) => fakeVersion(id, `content for ${id}`)),
    remove: vi.fn(async () => undefined),
    ...overrides.versionProvider,
  } as VersionProvider;

  const onClose = vi.fn();
  act(() => {
    root!.render(<VersionHistoryPanel open runtime={runtime} versionProvider={versionProvider} onClose={onClose} />);
  });
  return { runtime, versionProvider, onClose };
};

const click = (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === label) as HTMLButtonElement;
  act(() => button.click());
};

describe("VersionHistoryPanel", () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("lists versions from the provider on open", async () => {
    const entries: VersionListEntry[] = [{ id: "1", label: "First", createdAt: Date.now() }, { id: "2", label: "Second", createdAt: Date.now() }];
    const { versionProvider } = renderPanel({ versionProvider: { list: vi.fn(async () => entries) } });
    await flush();

    expect(versionProvider.list).toHaveBeenCalled();
    expect(document.querySelector('[data-srte-version-entry="1"]')?.textContent).toContain("First");
    expect(document.querySelector('[data-srte-version-entry="2"]')?.textContent).toContain("Second");
  });

  it("saving a version calls runtime.saveVersion with the entered label, then hands the result to the provider", async () => {
    const { runtime, versionProvider } = renderPanel();
    await flush();

    const input = document.querySelector('input[placeholder="Label this version (optional)"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, "Before big edit");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Save version");
    await flush();

    expect(runtime.saveVersion).toHaveBeenCalledWith({ label: "Before big edit" });
    expect(versionProvider.save).toHaveBeenCalled();
  });

  it("restoring loads the target version, calls runtime.restoreVersion, then records the restoration as a new forward version - never rewriting or deleting anything from the version list", async () => {
    const entries: VersionListEntry[] = [{ id: "old-1", label: "Old draft", createdAt: Date.now() }];
    const { runtime, versionProvider } = renderPanel({ versionProvider: { list: vi.fn(async () => entries) } });
    await flush();

    click("Restore");
    await flush();

    expect(versionProvider.load).toHaveBeenCalledWith("old-1");
    expect(runtime.restoreVersion).toHaveBeenCalled();
    // The new version recorded after restore is labeled to reference what
    // was restored, and the provider is asked to save it (append, not
    // replace) - remove() must never be called as part of a restore.
    expect(runtime.saveVersion).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining("Old draft") }));
    expect(versionProvider.save).toHaveBeenCalled();
    expect(versionProvider.remove).not.toHaveBeenCalled();
  });

  it("deleting a version calls versionProvider.remove with its id", async () => {
    const entries: VersionListEntry[] = [{ id: "doomed", label: "Delete me", createdAt: Date.now() }];
    const { versionProvider } = renderPanel({ versionProvider: { list: vi.fn(async () => entries) } });
    await flush();

    click("Delete");
    await flush();

    expect(versionProvider.remove).toHaveBeenCalledWith("doomed");
  });

  it("selecting two versions shows a diff summary computed between them", async () => {
    const entries: VersionListEntry[] = [{ id: "a", label: "A", createdAt: 1 }, { id: "b", label: "B", createdAt: 2 }];
    renderPanel({
      versionProvider: {
        list: vi.fn(async () => entries),
        load: vi.fn(async (id: string) => fakeVersion(id, id === "a" ? "hello" : "hello world")),
      },
    });
    await flush();

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    act(() => (checkboxes[0] as HTMLInputElement).click());
    act(() => (checkboxes[1] as HTMLInputElement).click());
    await flush();

    expect(document.querySelector('[data-srte-version-diff-summary="true"]')?.textContent).toContain("edited");
  });

  it("shows nothing when closed", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<VersionHistoryPanel open={false} runtime={{} as CanonicalEditorRuntime} versionProvider={{} as VersionProvider} onClose={() => {}} />);
    });
    expect(document.querySelector('[data-srte-version-history="true"]')).toBeNull();
  });
});
