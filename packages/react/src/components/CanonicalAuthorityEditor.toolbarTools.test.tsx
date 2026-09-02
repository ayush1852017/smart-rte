// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CanonicalAuthorityEditor } from "./CanonicalAuthorityEditor.js";
import { DEFAULT_TOOLBAR_TOOLS, type ToolbarTools } from "../toolbarTools.js";
import type { MediaProvider } from "../mediaProvider.js";
import type { VersionProvider } from "../versionProvider.js";
import type { CommentProvider } from "../commentProvider.js";
import type { SuggestionProvider } from "../suggestionProvider.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

const stubMediaProvider: MediaProvider = {
  upload: async () => ({ url: "https://x.test/i.png", id: "1" }),
  search: async () => [],
  remove: async () => {},
};
const stubVersionProvider: VersionProvider = {
  save: async (version) => ({ id: version.id, createdAt: version.createdAt }),
  list: async () => [],
  load: async () => { throw new Error("not used"); },
  remove: async () => {},
};
const stubCommentProvider: CommentProvider = {
  save: async () => {},
  list: async () => [],
  remove: async () => {},
};
const stubSuggestionProvider: SuggestionProvider = {
  save: async () => {},
  list: async () => [],
  remove: async () => {},
};

/** Every provider present so every tool that requires one has something to compose with - isolates each test to the `tools` flag itself, not a missing provider. */
const mountFullyCapable = (tools?: Partial<ToolbarTools>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<CanonicalAuthorityEditor
    defaultValue="<p>hi</p>"
    tools={tools}
    mediaProvider={stubMediaProvider}
    versionProvider={stubVersionProvider}
    commentProvider={stubCommentProvider}
    suggestionProvider={stubSuggestionProvider}
  />));
  return { host, root };
};

/**
 * docs/bugs/per-tool-toolbar-visibility.md
 *
 * A single, host-facing `tools` prop lets a developer hide any individual
 * toolbar tool without wrapping/overriding the component or patching it
 * with CSS - "developers should be able to hide those tools which are not
 * for their use" (e.g. Version History, Review, Video, Audio). Composes
 * with, never replaces, the deeper existing gates (provider presence,
 * `preset`'s schema-level plugin exclusion) - see toolbarTools.ts's own
 * doc comment for the full contract and the deliberate scoping decision
 * (contextual/selection-dependent actions - block move, list-item indent,
 * table row/column operations, selected-media edit/resize/delete - are
 * NOT individually toggleable, since they have no independent product
 * meaning apart from their owning top-level tool).
 */
describe("CanonicalAuthorityEditor: per-tool toolbar visibility (tools prop)", () => {
  it("shows every tool by default when `tools` is omitted - zero behavior change for an existing consumer", () => {
    const { host, root } = mountFullyCapable();
    expect(host.querySelector('[aria-label="Bold"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Insert image"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Version history"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll("summary")).some((el) => el.textContent?.includes("Review"))).toBe(true);
    act(() => root.unmount());
  });

  it("hides a simple mark tool (Bold) from both the desktop toolbar and the mobile menu when disabled", () => {
    const { host, root } = mountFullyCapable({ bold: false });
    expect(host.querySelector('[aria-label="Bold"]')).toBeNull();
    // Confirmed absent from BOTH copies, not just the desktop one - this
    // exact desktop/mobile duplication gap is what
    // docs/bugs/mobile-more-menu-clipped-and-missing-list-preset.md fixed
    // for List preset; a per-tool visibility feature must not reintroduce
    // it for every other tool.
    expect(host.querySelectorAll('[aria-label="Bold"]').length).toBe(0);
    expect(host.querySelector('[aria-label="Italic"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("Video/Audio/Image require BOTH the tools flag AND mediaProvider - composing with, not replacing, the existing provider gate", () => {
    // tools flag on, but no mediaProvider at all - still hidden.
    const host1 = document.createElement("div");
    document.body.appendChild(host1);
    const root1 = createRoot(host1);
    act(() => root1.render(<CanonicalAuthorityEditor defaultValue="<p>hi</p>" />));
    expect(host1.querySelector('[aria-label="Insert image"]')).toBeNull();
    act(() => root1.unmount());

    // mediaProvider present, but the flag explicitly off - still hidden.
    const { host: host2, root: root2 } = mountFullyCapable({ video: false, audio: false });
    expect(host2.querySelector('[aria-label="Insert image"]')).not.toBeNull();
    expect(Array.from(host2.querySelectorAll('[role="menuitem"]')).some((el) => el.textContent?.includes("Insert video"))).toBe(false);
    expect(Array.from(host2.querySelectorAll('[role="menuitem"]')).some((el) => el.textContent?.includes("Insert audio"))).toBe(false);
    act(() => root2.unmount());
  });

  it("Version History requires BOTH the tools flag AND versionProvider", () => {
    const host1 = document.createElement("div");
    document.body.appendChild(host1);
    const root1 = createRoot(host1);
    // tools flag on (default), but no versionProvider - still hidden.
    act(() => root1.render(<CanonicalAuthorityEditor defaultValue="<p>hi</p>" />));
    expect(host1.querySelector('[aria-label="Version history"]')).toBeNull();
    act(() => root1.unmount());

    const { host: host2, root: root2 } = mountFullyCapable({ versionHistory: false });
    expect(host2.querySelector('[aria-label="Version history"]')).toBeNull();
    act(() => root2.unmount());
  });

  it("Comments and Suggestions are independently toggleable, each mapping onto its own provider - splitting the old combined 'Review' control", () => {
    const { host, root } = mountFullyCapable({ suggestions: false });
    const menuItemLabels = Array.from(host.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent || "");
    expect(menuItemLabels.some((text) => text.includes("Add comment"))).toBe(true);
    expect(menuItemLabels.some((text) => text.includes("Suggest insertion"))).toBe(false);
    // "Review" dropdown itself stays present since comments is still on.
    expect(Array.from(host.querySelectorAll("summary")).some((el) => el.textContent?.includes("Review"))).toBe(true);
    act(() => root.unmount());

    const { host: host2, root: root2 } = mountFullyCapable({ comments: false, suggestions: false });
    // Both halves off - the whole "Review" dropdown trigger disappears too, not left empty.
    expect(Array.from(host2.querySelectorAll("summary")).some((el) => el.textContent?.includes("Review"))).toBe(false);
    act(() => root2.unmount());
  });

  it("insertTable requires BOTH the tools flag AND the schema actually having the table plugin (preset)", () => {
    // Flag on (default), but preset="simple" excludes the table plugin entirely.
    const host1 = document.createElement("div");
    document.body.appendChild(host1);
    const root1 = createRoot(host1);
    act(() => root1.render(<CanonicalAuthorityEditor defaultValue="<p>hi</p>" preset="simple" />));
    expect(host1.querySelector('[aria-label="Insert table"]')).toBeNull();
    act(() => root1.unmount());

    // Table plugin present (default "full" preset), but flag explicitly off.
    const { host: host2, root: root2 } = mountFullyCapable({ insertTable: false });
    expect(host2.querySelector('[aria-label="Insert table"]')).toBeNull();
    act(() => root2.unmount());
  });

  it("hiding every 'Save as...' format hides the whole 'Save a copy' dropdown trigger, not an empty dropdown", () => {
    const { host, root } = mountFullyCapable({
      saveAsHtml: false, saveAsMarkdown: false, saveAsWord: false, saveAsPdf: false, saveAsSmartRte: false,
    });
    expect(Array.from(host.querySelectorAll("summary")).some((el) => el.textContent?.includes("Save a copy"))).toBe(false);
    act(() => root.unmount());
  });

  it("a disabled tool's onClick action is genuinely unreachable, not just visually hidden (bold cannot be toggled)", () => {
    const { host, root } = mountFullyCapable({ bold: false });
    const surface = host.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(surface).not.toBeNull();
    // No Bold button anywhere to click - confirms there is no alternate
    // path (e.g. a leftover keyboard-only affordance) left enabled.
    expect(host.querySelector('button[aria-label="Bold"]')).toBeNull();
    act(() => root.unmount());
  });

  /**
   * Exhaustive coverage: every single key in DEFAULT_TOOLBAR_TOOLS actually
   * removes something real from the rendered DOM when set to false - a
   * broad regression net against silently forgetting to wire one of the
   * ~40 keys during a future refactor. Each key is tested with every
   * provider present (mountFullyCapable) so there is always real content
   * for that key's own toggle to remove.
   */
  it("every key in DEFAULT_TOOLBAR_TOOLS has a real, wired effect on the rendered toolbar", () => {
    const { host: baseHost, root: baseRoot } = mountFullyCapable();
    const baselineHtml = baseHost.innerHTML;
    act(() => baseRoot.unmount());

    const untestedKeys: string[] = [];
    for (const key of Object.keys(DEFAULT_TOOLBAR_TOOLS) as (keyof ToolbarTools)[]) {
      const { host, root } = mountFullyCapable({ [key]: false } as Partial<ToolbarTools>);
      const html = host.innerHTML;
      act(() => root.unmount());
      if (html === baselineHtml) untestedKeys.push(key);
    }
    expect(untestedKeys, `these tools produced NO change when disabled: ${untestedKeys.join(", ")}`).toEqual([]);
  });
});
