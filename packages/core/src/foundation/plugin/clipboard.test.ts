// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseClipboardPayload } from "../clipboard/pipeline.js";
import type { SourceNormalizer } from "../clipboard/types.js";
import { createPluginRegistry } from "./registry.js";
import type { FoundationPlugin } from "./types.js";

const baseSchema = { nodes: [{ type: "doc", group: "document" as const, content: "block+" }] };

/**
 * clipboard/pipeline.ts's parseClipboardPayload already had a
 * caller-supplied `options.normalizers` extension point that takes
 * priority over the built-in capturedSourceNormalizers fallback (see
 * pipeline.test.ts's "structurally sanitizes before invoking a source
 * normalizer"). Phase 10's plugin manifest reuses that existing point
 * directly - a plugin's `clipboard.normalizers` contribution, collected
 * and priority-ordered by createPluginRegistry, is exactly what
 * ClipboardPipelineOptions.normalizers expects. No new pipeline mechanism
 * was needed; this proves the two already fit together.
 */
describe("a plugin-contributed clipboard normalizer reaches the real pipeline", () => {
  it("registry.clipboardNormalizers, passed as pipeline options.normalizers, is selected over the built-in fallback", () => {
    let sawPayload = false;
    const customNormalizer: SourceNormalizer = {
      id: "custom-html-normalizer",
      sources: ["html"],
      normalize(payload) {
        sawPayload = true;
        return { html: payload.html, plainText: payload.plainText, repairs: [] };
      },
    };
    const plugin: FoundationPlugin = {
      id: "custom-clipboard-plugin",
      version: "1.0.0",
      commands: {},
      clipboard: { normalizers: [customNormalizer], priority: 100 },
    };
    const registry = createPluginRegistry([plugin], { baseSchema, schemaVersion: 1 });
    expect(registry.clipboardNormalizers).toEqual([customNormalizer]);

    parseClipboardPayload(
      { html: "<p>plain html</p>", plainText: "plain html" },
      { ownerDocument: document, normalizers: registry.clipboardNormalizers },
    );
    expect(sawPayload).toBe(true);
  });

  it("orders clipboard normalizers from multiple plugins by contribution priority", () => {
    const high: SourceNormalizer = { id: "high", sources: ["word"], normalize: (p) => ({ html: p.html, plainText: p.plainText, repairs: [] }) };
    const low: SourceNormalizer = { id: "low", sources: ["google-docs"], normalize: (p) => ({ html: p.html, plainText: p.plainText, repairs: [] }) };
    const pluginA: FoundationPlugin = { id: "a", version: "1.0.0", commands: {}, clipboard: { normalizers: [low], priority: 1 } };
    const pluginB: FoundationPlugin = { id: "b", version: "1.0.0", commands: {}, clipboard: { normalizers: [high], priority: 10 } };
    const registry = createPluginRegistry([pluginA, pluginB], { baseSchema, schemaVersion: 1 });
    expect(registry.clipboardNormalizers.map((n) => n.id)).toEqual(["high", "low"]);
  });
});
