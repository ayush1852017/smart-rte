import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { setBlockTypeCommand } from "./commands.js";
import { blockPluginCommands, blockToolbarContributions } from "./plugin.js";
import { createPluginRegistry } from "../plugin/registry.js";
import { builtInPlugins } from "../plugin/builtins.js";
import type { BlockRangeScope } from "../scope/types.js";
import type { SmartDocument } from "../types.js";

const document: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] },
] };
const ctx = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
const scope: BlockRangeScope = {
  kind: "block-range", blockIds: ["p"], promotedFromPartial: true, commonParentId: null,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 1 } }, isolatingAncestorId: null, clamped: false,
};

describe("block plugin", () => {
  it("block.setType, invoked through the registry, produces exactly what calling setBlockTypeCommand directly produces", () => {
    const params = { type: "heading" as const, attrs: { level: 2 } };
    const direct = setBlockTypeCommand(document, scope, params, ctx);
    const wrapped = blockPluginCommands["block.setType"].run(document, scope, params, ctx);
    expect(wrapped).toEqual(direct);
    expect(direct.length).toBeGreaterThan(0);
  });

  it("carries exactly the seven commands the pre-existing blockCommands record exposes, plus the Tier-0 code-indent Tab command", () => {
    expect(Object.keys(blockPluginCommands).sort()).toEqual([
      "block.code.indentTab", "block.indent", "block.move", "block.outdent", "block.setAttributes", "block.setType", "block.unwrap", "block.wrap",
    ]);
  });

  it("block.code.indentTab inserts a tab inside a code block and produces no operations outside one", () => {
    const code: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "code_block", id: "c", attrs: { language: null }, children: [{ type: "text", text: "x" }] },
    ] };
    const codeScope: BlockRangeScope = { ...scope, blockIds: ["c"], range: { from: { path: [0], offset: 1 }, to: { path: [0], offset: 1 } } };
    const operations = blockPluginCommands["block.code.indentTab"].run(code, codeScope, undefined, ctx);
    expect(operations).toEqual([{ type: "insertText", pos: { path: [0], offset: 1 }, text: "\t" }]);
    expect(blockPluginCommands["block.code.indentTab"].run(document, scope, undefined, ctx)).toEqual([]);
  });

  it("every declared toolbar contribution references a real command id, and skips the id-dependent wrapToggle declaration", () => {
    blockToolbarContributions.forEach((contribution) => expect(blockPluginCommands[contribution.commandId]).toBeDefined());
    expect(blockToolbarContributions.some((c) => c.id === "block.toolbar.blockquote")).toBe(false);
  });

  it("every block command has a non-empty description", () => {
    Object.values(blockPluginCommands).forEach((command) => expect(command.description.trim().length).toBeGreaterThan(0));
  });

  it("registers cleanly as part of the full built-in plugin set with no id collisions", () => {
    const registry = createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    });
    expect(registry.commands.get("block.setType")).toBeDefined();
    expect(registry.toolbar.some((c) => c.commandId === "block.setType")).toBe(true);
  });
});
