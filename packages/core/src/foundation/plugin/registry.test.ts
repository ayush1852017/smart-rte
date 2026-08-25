import { describe, expect, it } from "vitest";
import { createPluginRegistry } from "./registry.js";
import type { FoundationPlugin } from "./types.js";

const baseSchema = {
  nodes: [{ type: "doc", group: "document" as const, content: "block+" }],
};

const command = (id: string, description = `does ${id}`) => ({
  id, description, run: () => [],
});

const plugin = (overrides: Partial<FoundationPlugin> & { id: string }): FoundationPlugin => ({
  version: "1.0.0",
  commands: {},
  ...overrides,
});

describe("createPluginRegistry", () => {
  it("merges schema nodes/marks from the base schema and every plugin", () => {
    const a = plugin({ id: "a", schema: { nodes: [{ type: "paragraph", group: "block", content: "text*" }] } });
    const b = plugin({ id: "b", schema: { marks: [{ type: "bold" }] } });
    const registry = createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 });
    expect(Object.keys(registry.schema.nodes)).toEqual(["doc", "paragraph"]);
    expect(Object.keys(registry.schema.marks)).toEqual(["bold"]);
  });

  it("merges commands into a flat lookup", () => {
    const a = plugin({ id: "a", commands: { "a.one": command("a.one") } });
    const b = plugin({ id: "b", commands: { "b.one": command("b.one") } });
    const registry = createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 });
    expect([...registry.commands.keys()]).toEqual(["a.one", "b.one"]);
  });

  it("throws on duplicate plugin id", () => {
    const a = plugin({ id: "dup" });
    const b = plugin({ id: "dup" });
    expect(() => createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 })).toThrow(/Duplicate plugin id/);
  });

  it("throws on duplicate command id across plugins", () => {
    const a = plugin({ id: "a", commands: { x: command("shared") } });
    const b = plugin({ id: "b", commands: { x: command("shared") } });
    expect(() => createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 })).toThrow(/Duplicate command id "shared"/);
  });

  it("throws when a command has an empty description", () => {
    const a = plugin({ id: "a", commands: { x: { id: "x", description: "  ", run: () => [] } } });
    expect(() => createPluginRegistry([a], { baseSchema, schemaVersion: 1 })).toThrow(/requires a non-empty description/);
  });

  it("orders plugins so requires are registered before the dependent", () => {
    const checklist = plugin({ id: "checklist", requires: ["list"] });
    const list = plugin({ id: "list" });
    const registry = createPluginRegistry([checklist, list], { baseSchema, schemaVersion: 1 });
    expect(registry.plugins.map((p) => p.id)).toEqual(["list", "checklist"]);
  });

  it("throws on a missing hard dependency", () => {
    const checklist = plugin({ id: "checklist", requires: ["list"] });
    expect(() => createPluginRegistry([checklist], { baseSchema, schemaVersion: 1 })).toThrow(/requires missing plugin "list"/);
  });

  it("does not throw on a missing optional dependency, and orders it when present", () => {
    const a = plugin({ id: "a", optional: ["b"] });
    expect(() => createPluginRegistry([a], { baseSchema, schemaVersion: 1 })).not.toThrow();
    const b = plugin({ id: "b" });
    const registry = createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 });
    expect(registry.plugins.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("throws on a circular dependency", () => {
    const a = plugin({ id: "a", requires: ["b"] });
    const b = plugin({ id: "b", requires: ["a"] });
    expect(() => createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 })).toThrow(/Circular plugin dependency/);
  });

  it("throws when a contribution references a missing command id", () => {
    const a = plugin({
      id: "a",
      commands: {},
      toolbar: [{ id: "btn", commandId: "nonexistent", label: "Btn" }],
    });
    expect(() => createPluginRegistry([a], { baseSchema, schemaVersion: 1 })).toThrow(/references missing command "nonexistent"/);
  });

  it("throws on duplicate toolbar contribution id", () => {
    const a = plugin({ id: "a", commands: { x: command("x") }, toolbar: [{ id: "btn", commandId: "x", label: "A" }] });
    const b = plugin({ id: "b", commands: { y: command("y") }, toolbar: [{ id: "btn", commandId: "y", label: "B" }] });
    expect(() => createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 })).toThrow(/Duplicate Toolbar contribution id "btn"/);
  });

  it("orders toolbar/shortcuts/contextMenu by priority then registration order", () => {
    const a = plugin({
      id: "a",
      commands: { x: command("x"), y: command("y"), z: command("z") },
      toolbar: [
        { id: "low", commandId: "x", label: "Low", order: undefined, priority: 0 } as never,
        { id: "high", commandId: "y", label: "High", priority: 10 } as never,
        { id: "mid", commandId: "z", label: "Mid", priority: 5 } as never,
      ],
    });
    const registry = createPluginRegistry([a], { baseSchema, schemaVersion: 1 });
    expect(registry.toolbar.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("orders clipboard normalizers by contribution priority then registration order", () => {
    const normalizerA = { id: "norm-a", sources: ["word" as const], normalize: (payload: unknown) => payload as never };
    const normalizerB = { id: "norm-b", sources: ["googleDocs" as const], normalize: (payload: unknown) => payload as never };
    const a = plugin({ id: "a", clipboard: { normalizers: [normalizerA], priority: 0 } });
    const b = plugin({ id: "b", clipboard: { normalizers: [normalizerB], priority: 5 } });
    const registry = createPluginRegistry([a, b], { baseSchema, schemaVersion: 1 });
    expect(registry.clipboardNormalizers.map((n) => n.id)).toEqual(["norm-b", "norm-a"]);
  });

  it("exposes hasPlugin", () => {
    const registry = createPluginRegistry([plugin({ id: "a" })], { baseSchema, schemaVersion: 1 });
    expect(registry.hasPlugin("a")).toBe(true);
    expect(registry.hasPlugin("b")).toBe(false);
  });
});
