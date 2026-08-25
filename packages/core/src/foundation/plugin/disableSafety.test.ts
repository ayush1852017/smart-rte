import { describe, expect, it } from "vitest";
import { repair, restoreUnknownMarks, restoreUnknownNodes, validate } from "../schema.js";
import { builtInPlugins } from "./builtins.js";
import { createPluginRegistry } from "./registry.js";
import type { SmartDocument, SmartElementNode } from "../types.js";

// Matches the real base schema (schema.ts): doc/text/unknown/unknown-mark
// only - paragraph is block-plugin-owned, not a base type, so disabling
// "block" legitimately affects every paragraph too (exercised separately
// below).
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
  marks: [
    { type: "unknown-mark", attributes: {
      originalType: { required: true, validate: (v: unknown) => typeof v === "string" },
      originalAttrs: {},
    } },
  ],
};
const fullRegistry = createPluginRegistry(builtInPlugins, { baseSchema, schemaVersion: 1 });

const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });

/**
 * Phase 10 gates 7/8: for every plugin that owns a node type (list, table,
 * atom - block is exercised separately since paragraph, used as
 * "untouched surrounding content" here, is itself block-owned), disabling
 * it must demote that content to a read-only, round-tripping `unknown`
 * node, and re-enabling must restore it losslessly with no edits made in
 * between.
 */
describe.each([
  {
    pluginId: "list",
    document: (): SmartDocument => ({ type: "doc", id: "doc", children: [
      p("before", "before"),
      { type: "list", id: "l", attrs: { style: "disc" }, children: [
        { type: "list_item", id: "li", children: [p("li-p", "item")] },
      ] },
      p("after", "after"),
    ] }),
  },
  {
    pluginId: "table",
    document: (): SmartDocument => ({ type: "doc", id: "doc", children: [
      p("before", "before"),
      { type: "table", id: "t", attrs: { columnWidths: [100] }, children: [
        { type: "table_row", id: "r", children: [{ type: "table_cell", id: "c", attrs: { rowspan: 1, colspan: 1, header: false }, children: [p("c-p", "cell")] }] },
      ] },
      p("after", "after"),
    ] }),
  },
  {
    pluginId: "atom",
    document: (): SmartDocument => ({ type: "doc", id: "doc", children: [
      p("before", "before"),
      { type: "block_formula", id: "f", attrs: { source: "x^2", notation: "latex" }, children: [] },
      p("after", "after"),
    ] }),
  },
])("$pluginId plugin: disable then re-enable round-trips losslessly", ({ pluginId, document }) => {
  it("disabling demotes this plugin's content to unknown; re-enabling restores it exactly", () => {
    const original = document();
    expect(validate(original, fullRegistry.schema)).toEqual([]);

    const reducedRegistry = createPluginRegistry(builtInPlugins.filter((plugin) => plugin.id !== pluginId), { baseSchema, schemaVersion: 1 });
    const { doc: disabled } = repair(original, reducedRegistry.schema);
    expect(validate(disabled, reducedRegistry.schema)).toEqual([]);
    // The unrelated before/after paragraphs must be untouched.
    expect(disabled.children[0]).toEqual(original.children[0]);
    expect(disabled.children[disabled.children.length - 1]).toEqual(original.children[original.children.length - 1]);
    // Something in the middle must have become an unknown passthrough.
    expect(disabled.children.some((child) => !("text" in child) && child.type === "unknown")).toBe(true);

    const restored = restoreUnknownNodes(disabled, fullRegistry.schema);
    expect(restored).toEqual(original);
    expect(validate(restored, fullRegistry.schema)).toEqual([]);
  });
});

describe("block plugin: disable then re-enable round-trips losslessly", () => {
  it("disabling demotes paragraphs and blockquotes alike (block owns both); re-enabling restores exactly", () => {
    const original: SmartDocument = { type: "doc", id: "doc", children: [
      p("p1", "plain"),
      { type: "blockquote", id: "bq", children: [p("bq-p", "quoted")] },
    ] };
    expect(validate(original, fullRegistry.schema)).toEqual([]);

    const withoutBlock = createPluginRegistry(builtInPlugins.filter((plugin) => plugin.id !== "block"), { baseSchema, schemaVersion: 1 });
    const { doc: disabled } = repair(original, withoutBlock.schema);
    expect(validate(disabled, withoutBlock.schema)).toEqual([]);
    expect(disabled.children.every((child) => !("text" in child) && child.type === "unknown")).toBe(true);

    const restored = restoreUnknownNodes(disabled, fullRegistry.schema);
    expect(restored).toEqual(original);
    expect(validate(restored, fullRegistry.schema)).toEqual([]);
  });
});

/**
 * Marks live in schema.marks, not schema.nodes, so they don't go through
 * repair()'s node-side "preserve-unknown" path - but repair()'s separate
 * mark-filtering loop has its own mark-side passthrough ("unknown-mark",
 * see schema.ts), making disabling "marks" round-trip losslessly the same
 * way the four node-owning plugins do below. Previously documented as a
 * lossy, disable-unsafe limitation in docs/bugs/plugin-disable-marks-is-lossy.md;
 * fixed as part of Phase 11 Tier 0.
 */
describe("marks plugin: disable then re-enable round-trips losslessly", () => {
  it("disabling demotes an unrecognized mark to unknown-mark; re-enabling restores it exactly", () => {
    const original: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "text", text: "bold text", marks: [{ type: "bold" }] }] },
    ] };
    expect(validate(original, fullRegistry.schema)).toEqual([]);

    const withoutMarks = createPluginRegistry(builtInPlugins.filter((plugin) => plugin.id !== "marks"), { baseSchema, schemaVersion: 1 });
    const { doc: disabled, repairs } = repair(original, withoutMarks.schema);
    expect(validate(disabled, withoutMarks.schema)).toEqual([]);
    expect(repairs.some((r) => r.code === "preserve-unknown-mark")).toBe(true);
    const textNode = (disabled.children[0] as SmartElementNode).children![0];
    expect("marks" in textNode ? textNode.marks : undefined).toEqual([{ type: "unknown-mark", attrs: { originalType: "bold" } }]);

    const restored = restoreUnknownMarks(restoreUnknownNodes(disabled, fullRegistry.schema), fullRegistry.schema);
    expect(restored).toEqual(original);
    expect(validate(restored, fullRegistry.schema)).toEqual([]);
  });
});
