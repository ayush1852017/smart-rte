import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { occupancyGridFor, setTableColumnWidthCommand } from "./index.js";
import { tablePluginCommands } from "./plugin.js";
import { createPluginRegistry } from "../plugin/registry.js";
import { builtInPlugins } from "../plugin/builtins.js";
import type { TableGridScope } from "../scope/types.js";
import type { SmartDocument, SmartElementNode } from "../types.js";

const cell = (id: string, text: string): SmartElementNode => ({
  type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false },
  children: [{ type: "paragraph", id: `${id}-p`, children: text ? [{ type: "text", text }] : [] }],
});
const document: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "table", id: "t", attrs: { columnWidths: [100, 100] }, children: [
    { type: "table_row", id: "r0", children: [cell("a", "A"), cell("b", "B")] },
  ] },
] };
const table = document.children[0] as SmartElementNode;
const ctx = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
const scope: TableGridScope = {
  kind: "table-grid", tableId: "t", rect: { top: 0, left: 0, bottom: 0, right: 0 }, cellIds: ["a"], coveredCellIds: [],
  rectangular: true, range: { from: { path: [0, 0, 0, 0], offset: 0 }, to: { path: [0, 0, 0, 0], offset: 0 } },
  isolatingAncestorId: null, clamped: false,
};

describe("table plugin", () => {
  it("table.setColumnWidth, invoked through the registry, produces exactly what calling setTableColumnWidthCommand directly produces", () => {
    const params = { index: 0, width: 150 };
    const direct = setTableColumnWidthCommand(document, scope, params, ctx);
    const wrapped = tablePluginCommands["table.setColumnWidth"].run(document, scope, params, ctx);
    expect(wrapped).toEqual(direct);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((op) => op.type !== "replaceNode" || (op as { before: SmartElementNode }).before.type !== "table")).toBe(true);
  });

  it("carries exactly the fourteen commands the pre-existing tableCommands record exposes", () => {
    expect(Object.keys(tablePluginCommands).sort()).toEqual([
      "table.insert", "table.insertColumn", "table.insertRow", "table.mergeCells", "table.moveColumn", "table.moveRow",
      "table.remove", "table.removeColumn", "table.removeRow", "table.setCellAttributes", "table.setColumnWidth",
      "table.setHeader", "table.setRowHeight", "table.splitCell",
    ]);
  });

  it("every table command has a non-empty description", () => {
    Object.values(tablePluginCommands).forEach((command) => expect(command.description.trim().length).toBeGreaterThan(0));
  });

  it("registers cleanly as part of the full built-in plugin set with no id collisions", () => {
    const registry = createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    });
    expect(registry.commands.get("table.mergeCells")).toBeDefined();
    expect(occupancyGridFor(table).columns).toBe(2);
  });
});
