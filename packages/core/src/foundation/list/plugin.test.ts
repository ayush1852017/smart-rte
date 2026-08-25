import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { indentList } from "./commands.js";
import { listPluginCommands } from "./plugin.js";
import { createPluginRegistry } from "../plugin/registry.js";
import { builtInPlugins } from "../plugin/builtins.js";
import type { ListSelectionScope } from "../scope/types.js";
import type { CommandContext, SmartDocument, SmartElementNode } from "../types.js";

const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const item = (id: string, text: string): SmartElementNode => ({ type: "list_item", id, children: [p(`${id}-p`, text)] });
const document: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "list", id: "l", attrs: { style: "disc" }, children: [item("a", "A"), item("b", "B")] },
] };
const ctx: CommandContext = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
const scope: ListSelectionScope = {
  kind: "list-selection", listId: "l", items: [{ itemId: "b", depth: 0, hasChildList: false }],
  partialSubtree: false, promotedFromPartial: false,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 1 } }, isolatingAncestorId: null, clamped: false,
};

describe("list plugin", () => {
  it("list.indent, invoked through the registry, produces exactly what calling indentList directly produces", () => {
    const direct = indentList(document, scope, { nestedListIds: ["new-list"] }, ctx);
    const wrapped = listPluginCommands["list.indent"].run(document, scope, { nestedListIds: ["new-list"] }, ctx);
    expect(wrapped).toEqual(direct);
    expect(direct.length).toBeGreaterThan(0);
  });

  it("carries exactly the ten commands the pre-existing listCommands record exposes", () => {
    expect(Object.keys(listPluginCommands).sort()).toEqual([
      "list.continueNumbering", "list.create", "list.indent", "list.move", "list.outdent",
      "list.restartNumbering", "list.setChecked", "list.setPreset", "list.setStyle", "list.unwrap",
    ]);
  });

  it("every list command has a non-empty description", () => {
    Object.values(listPluginCommands).forEach((command) => expect(command.description.trim().length).toBeGreaterThan(0));
  });

  it("registers cleanly as part of the full built-in plugin set with no id collisions", () => {
    const registry = createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    });
    expect(registry.commands.get("list.indent")).toBeDefined();
  });
});
