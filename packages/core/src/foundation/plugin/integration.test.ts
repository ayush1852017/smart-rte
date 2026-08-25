import { describe, expect, it } from "vitest";
import { createFoundationEditor } from "../editor.js";
import { repair, restoreUnknownNodes, validate } from "../schema.js";
import type { SmartDocument } from "../types.js";
import { builtInPlugins } from "./builtins.js";
import { createPluginRegistry } from "./registry.js";

const baseSchema = {
  nodes: [
    { type: "doc", group: "document" as const, content: "block+" },
    { type: "text", group: "inline" as const, marks: "_all" as const },
    { type: "unknown", group: "block" as const, atomic: true, isolating: true, selectable: true, attributes: {
      originalType: { required: true, validate: (v: unknown) => typeof v === "string" },
      originalGroup: { required: true, validate: (v: unknown) => v === "block" || v === "inline" },
      raw: { required: true },
      editable: { default: false, validate: (v: unknown) => v === false },
    } },
  ],
};

describe("plugin registration is genuinely load-bearing for the live editor", () => {
  it("createFoundationEditor's default schema is the registry's output for the full built-in plugin set", () => {
    const editor = createFoundationEditor({
      document: { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [] }] },
      selection: { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } },
    });
    expect(editor.schema.nodes.table).toBeDefined();
    expect(editor.schema.nodes.list).toBeDefined();
    expect(editor.schema.marks.bold).toBeDefined();
  });

  it("registering a reduced plugin set (table excluded) shrinks the live schema, and repair() demotes a table node to unknown", () => {
    const withoutTable = builtInPlugins.filter((plugin) => plugin.id !== "table");
    const registry = createPluginRegistry(withoutTable, { baseSchema, schemaVersion: 1 });
    expect(registry.schema.nodes.table).toBeUndefined();
    expect(registry.schema.nodes.list).toBeDefined();

    const documentWithTable: SmartDocument = {
      type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p", children: [] },
        { type: "table", id: "t", attrs: { columnWidths: [100] }, children: [
          { type: "table_row", id: "r", children: [
            { type: "table_cell", id: "c", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "cp", children: [] }] },
          ] },
        ] },
      ],
    };

    const { doc: repaired } = repair(documentWithTable, registry.schema);
    const tableReplacement = repaired.children[1];
    expect(tableReplacement).toMatchObject({ type: "unknown", attrs: { originalType: "table", originalGroup: "block", editable: false } });
    expect(validate(repaired, registry.schema)).toEqual([]);
  });

  it("re-registering the excluded plugin restores the schema's ability to recognize the node type again", () => {
    const withoutTable = builtInPlugins.filter((plugin) => plugin.id !== "table");
    const reduced = createPluginRegistry(withoutTable, { baseSchema, schemaVersion: 1 });
    expect(reduced.schema.nodes.table).toBeUndefined();

    const full = createPluginRegistry(builtInPlugins, { baseSchema, schemaVersion: 1 });
    expect(full.schema.nodes.table).toBeDefined();
  });

  it("disable then re-enable round-trips to a byte-for-byte identical document (gates 7/8)", () => {
    const withoutTable = createPluginRegistry(builtInPlugins.filter((plugin) => plugin.id !== "table"), { baseSchema, schemaVersion: 1 });
    const fullRegistry = createPluginRegistry(builtInPlugins, { baseSchema, schemaVersion: 1 });

    const original: SmartDocument = {
      type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p1", children: [{ type: "text", text: "before" }] },
        { type: "table", id: "t", attrs: { columnWidths: [100, 100] }, children: [
          { type: "table_row", id: "r1", children: [
            { type: "table_cell", id: "c1", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "c1p", children: [{ type: "text", text: "A" }] }] },
            { type: "table_cell", id: "c2", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "c2p", children: [{ type: "text", text: "B" }] }] },
          ] },
        ] },
        { type: "paragraph", id: "p2", children: [{ type: "text", text: "after" }] },
      ],
    };
    expect(validate(original, fullRegistry.schema)).toEqual([]);

    // Disable: the table plugin is no longer registered, so its content
    // demotes to an unknown, read-only, round-tripping passthrough.
    const { doc: disabled } = repair(original, withoutTable.schema);
    expect(disabled.children[1]).toMatchObject({ type: "unknown", attrs: { originalType: "table" } });
    expect(validate(disabled, withoutTable.schema)).toEqual([]);
    // The rest of the document is untouched by disabling an unrelated plugin.
    expect(disabled.children[0]).toEqual(original.children[0]);
    expect(disabled.children[2]).toEqual(original.children[2]);

    // Re-enable: the table plugin is registered again, with no edits made
    // while it was disabled - the document must restore exactly.
    const restored = restoreUnknownNodes(disabled, fullRegistry.schema);
    expect(restored).toEqual(original);
    expect(validate(restored, fullRegistry.schema)).toEqual([]);
  });
});
