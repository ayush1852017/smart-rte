import { describe, expect, it } from "vitest";
import { checklistPlugin, formulaPlugin, listPlugin, type SmartRtePlugin } from "smartrte-core/legacy";
import { createReactEditorPluginRuntime, matchesPluginShortcut } from "./pluginRuntime.js";

describe("React editor plugin runtime", () => {
  it("filters the standard preset and keeps dependency-safe features", () => {
    const runtime = createReactEditorPluginRuntime({
      features: { table: false, media: false, list: false },
    });
    expect(runtime.hasFeature("table")).toBe(false);
    expect(runtime.hasFeature("media")).toBe(false);
    expect(runtime.hasFeature("list")).toBe(false);
    expect(runtime.hasFeature("checklist")).toBe(false);
    expect(runtime.hasFeature("formula")).toBe(true);
  });

  it("accepts an exact custom plugin set", () => {
    const custom: SmartRtePlugin = { id: "custom-feature", commands: {} };
    const runtime = createReactEditorPluginRuntime({
      plugins: [formulaPlugin, custom],
    });
    expect(runtime.plugins.map((plugin) => plugin.id)).toEqual(["formula", "custom-feature"]);
    expect(runtime.hasFeature("formula")).toBe(true);
    expect(runtime.hasFeature("table")).toBe(false);
  });

  it("validates dependencies in custom plugin sets", () => {
    expect(() => createReactEditorPluginRuntime({ plugins: [checklistPlugin] }))
      .toThrow('requires missing plugin "list"');
    expect(createReactEditorPluginRuntime({ plugins: [checklistPlugin, listPlugin] }).hasFeature("checklist"))
      .toBe(true);
  });

  it("collects command-backed toolbar contributions and rejects invalid ones", () => {
    const plugin = {
      id: "custom",
      commands: {
        "custom.run": {
          id: "custom.run",
          isEnabled: () => true,
          execute: (context: any) => ({
            id: "custom.run",
            source: "user" as const,
            operations: [],
            selectionBefore: context.selection,
            selectionAfter: context.selection,
            addToHistory: true,
            timestamp: 1,
          }),
        },
      },
      react: {
        toolbar: [{
          id: "custom-button",
          commandId: "custom.run",
          label: "Custom",
          placement: "main" as const,
        }],
        shortcuts: [{
          id: "custom-shortcut",
          commandId: "custom.run",
          key: "K",
          primary: true,
          shift: true,
        }],
        contextMenu: [{
          id: "custom-context",
          commandId: "custom.run",
          label: "Run custom",
        }],
      },
    };
    const runtime = createReactEditorPluginRuntime({ plugins: [plugin] });
    expect(runtime.toolbar).toEqual([expect.objectContaining({ id: "custom-button" })]);
    expect(runtime.shortcuts).toEqual([expect.objectContaining({ id: "custom-shortcut", key: "k" })]);
    expect(runtime.contextMenu).toEqual([expect.objectContaining({ id: "custom-context" })]);
    expect(matchesPluginShortcut(
      { key: "K", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
      runtime.shortcuts[0],
    )).toBe(true);

    expect(() => createReactEditorPluginRuntime({
      plugins: [{
        ...plugin,
        react: { toolbar: [{ id: "broken", commandId: "missing", label: "Broken" }] },
      }],
    })).toThrow('references missing command "missing"');
  });

  it("orders stateful contributions and collects plugin format hooks", () => {
    const command = {
      id: "custom.run",
      isEnabled: () => true,
      execute: (context: any) => ({
        id: "custom.run",
        source: "user" as const,
        operations: [],
        selectionBefore: context.selection,
        selectionAfter: context.selection,
        addToHistory: true,
        timestamp: 1,
      }),
    };
    const runtime = createReactEditorPluginRuntime({
      plugins: [{
        id: "custom",
        commands: { "custom.run": command },
        react: {
          toolbar: [
            { id: "later", commandId: "custom.run", label: "Later", order: 20 },
            {
              id: "earlier",
              commandId: "custom.run",
              label: "Earlier",
              order: 10,
              isEnabled: ({ readOnly }) => !readOnly,
              isActive: () => true,
            },
          ],
        },
      }],
    });
    expect(runtime.toolbar.map(({ id }) => id)).toEqual(["earlier", "later"]);
    expect(runtime.toolbar[0].isActive?.({
      root: null,
      selection: null,
      readOnly: false,
      canExecute: () => true,
    })).toBe(true);
  });
});
