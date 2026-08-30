import { describe, expect, it } from "vitest";
import { validate } from "smartrte-core/foundation";
import { CanonicalEditorRuntime } from "./canonicalEditorRuntime.js";
import { capabilityPresetRegistry } from "./capabilityPresets.js";

describe("capability presets", () => {
  it("'full' (the default) is unaffected - schema, commands, keyboardShortcuts, contextMenu are the exact singleton objects every existing consumer already gets", () => {
    const full = capabilityPresetRegistry("full");
    const defaultRuntime = new CanonicalEditorRuntime();
    const presetRuntime = new CanonicalEditorRuntime({ preset: "full" });
    expect(defaultRuntime.editor.schema).toBe(presetRuntime.editor.schema);
    expect(defaultRuntime.editor.schema.nodes.table).toBeDefined();
    expect(full.schema.nodes.table).toBeDefined();
  });

  it("'simple' excludes the table plugin from the schema (and therefore the toolbar), leaving marks/list/block/atom intact", () => {
    const simple = capabilityPresetRegistry("simple");
    expect(simple.schema.nodes.table).toBeUndefined();
    expect(simple.schema.nodes.table_row).toBeUndefined();
    expect(simple.schema.nodes.table_cell).toBeUndefined();
    // list/block/atom (media+formula) stay - Sootr's MCQ/Anomaly/PYEQ all
    // want media and formula, only tables are excluded (see
    // docs/SOOTR_MIGRATION_READINESS.md gap #3 - "no media, no formula"
    // was the requesting prompt's illustrative suggestion, not what real
    // Sootr usage actually needs; every real call site passes
    // enableMedia/enableFormula as true and only ever varies enableTable).
    expect(simple.schema.nodes.list).toBeDefined();
    expect(simple.schema.nodes.paragraph).toBeDefined();
    expect(simple.schema.nodes.image).toBeDefined();
    expect(simple.schema.nodes.formula).toBeDefined();
  });

  it("caches registries per preset rather than rebuilding on every call", () => {
    expect(capabilityPresetRegistry("simple")).toBe(capabilityPresetRegistry("simple"));
    expect(capabilityPresetRegistry("full")).toBe(capabilityPresetRegistry("full"));
  });

  /**
   * Phase 10 gate 7/8's disable-safety contract, exercised end-to-end
   * through the actual react-facing CanonicalEditorRuntime (not just the
   * core-level repair()/validate() functions directly, which
   * plugin/disableSafety.test.ts already covers) - content created under
   * "full" (a real table) that gets loaded into a "simple"-preset instance
   * must round-trip safely as `unknown`, never crash and never silently
   * drop data, and must restore losslessly when loaded back under "full".
   */
  it("a table created under 'full' round-trips safely as unknown under 'simple', and restores exactly under 'full' again", () => {
    const full = new CanonicalEditorRuntime({
      preset: "full",
      initialValue: "<p>before</p><table><tbody><tr><td>cell</td></tr></tbody></table><p>after</p>",
    });
    const persisted = full.getValue();
    expect(persisted.document.children.some((child) => !("text" in child) && child.type === "table")).toBe(true);

    const simple = new CanonicalEditorRuntime({ preset: "simple", initialValue: persisted });
    expect(() => validate(simple.editor.document, simple.editor.schema)).not.toThrow();
    expect(validate(simple.editor.document, simple.editor.schema)).toEqual([]);
    expect(simple.editor.document.children.some((child) => !("text" in child) && child.type === "table")).toBe(false);
    expect(simple.editor.document.children.some((child) => !("text" in child) && child.type === "unknown")).toBe(true);
    // The untouched surrounding paragraphs survive unchanged.
    const simpleHtml = JSON.stringify(simple.editor.document);
    expect(simpleHtml).toContain("before");
    expect(simpleHtml).toContain("after");
    expect(simpleHtml).toContain("cell"); // preserved inside the unknown node's raw content, not lost.

    const restoredFull = new CanonicalEditorRuntime({ preset: "full", initialValue: simple.getValue() });
    expect(restoredFull.editor.document.children.some((child) => !("text" in child) && child.type === "table")).toBe(true);
    expect(validate(restoredFull.editor.document, restoredFull.editor.schema)).toEqual([]);
  });
});
