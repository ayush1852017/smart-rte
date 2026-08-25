import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { toggleMarkCommand } from "./commands.js";
import { markPluginCommands, markToolbarContributions } from "./plugin.js";
import { createPluginRegistry } from "../plugin/registry.js";
import { builtInPlugins } from "../plugin/builtins.js";
import type { InlineRangeScope } from "../scope/types.js";
import type { SmartDocument } from "../types.js";

const document: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] },
] };
const ctx = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
const scope = createScopeIndex().resolve(document, {
  type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 5 },
}, { want: "inline-range" }, foundationSchema) as InlineRangeScope;

describe("marks plugin", () => {
  it("mark.toggle, invoked through the registry, produces exactly what calling toggleMarkCommand directly produces", () => {
    const direct = toggleMarkCommand(document, scope, { markType: "bold" }, ctx);
    const wrapped = markPluginCommands["mark.toggle"].run(document, scope, { markType: "bold" }, ctx);
    expect(wrapped).toEqual(direct);
    expect(direct.length).toBeGreaterThan(0);
  });

  it("every declared toolbar contribution references a real command id", () => {
    markToolbarContributions.forEach((contribution) => {
      expect(markPluginCommands[contribution.commandId]).toBeDefined();
    });
    expect(markToolbarContributions.length).toBeGreaterThan(0);
  });

  it("every mark command has a non-empty description", () => {
    Object.values(markPluginCommands).forEach((command) => {
      expect(command.description.trim().length).toBeGreaterThan(0);
    });
  });

  it("registers cleanly as part of the full built-in plugin set with no id collisions", () => {
    const registry = createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    });
    expect(registry.commands.get("mark.toggle")).toBeDefined();
    expect(registry.toolbar.some((c) => c.commandId === "mark.toggle")).toBe(true);
  });
});
