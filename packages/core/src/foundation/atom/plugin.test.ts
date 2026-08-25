import { describe, expect, it } from "vitest";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import { insertAtom } from "./commands.js";
import { atomDeclarations, atomPluginCommands } from "./plugin.js";
import { createPluginRegistry } from "../plugin/registry.js";
import { builtInPlugins } from "../plugin/builtins.js";
import type { SmartDocument } from "../types.js";

const emptyScope = { kind: "empty" as const, range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: 0 } }, isolatingAncestorId: null, clamped: false };
const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "ab" }] }] };
const ctx = { schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) };
const image = atomDeclarations.find((d) => d.type === "image")!;

describe("atom plugin", () => {
  it("atom.insert, invoked through the registry, produces exactly what calling insertAtom directly produces", () => {
    const params = { declaration: image, nodeId: "img", attrs: { src: "https://example.test/a.png", alt: "A" }, ownerId: "p", offset: 1 };
    const direct = insertAtom(document, emptyScope, params, ctx);
    const wrapped = atomPluginCommands["atom.insert"].run(document, emptyScope, params, ctx);
    expect(wrapped).toEqual(direct);
    expect(direct.length).toBeGreaterThan(0);
  });

  it("carries exactly the four commands the pre-existing atomCommands record exposes", () => {
    expect(Object.keys(atomPluginCommands).sort()).toEqual(["atom.delete", "atom.insert", "atom.resize", "atom.update"]);
  });

  it("every atom command has a non-empty description", () => {
    Object.values(atomPluginCommands).forEach((command) => expect(command.description.trim().length).toBeGreaterThan(0));
  });

  it("registers cleanly as part of the full built-in plugin set with no id collisions", () => {
    const registry = createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    });
    expect(registry.commands.get("atom.insert")).toBeDefined();
    expect(registry.schema.nodes.image).toBeDefined();
  });
});
