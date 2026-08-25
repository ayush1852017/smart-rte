import { describe, expect, it } from "vitest";
import { createFoundationEditor } from "../editor.js";
import { baseSchema, foundationRegistry } from "../schema.js";
import { builtInPlugins } from "./builtins.js";
import { resolveShortcut } from "./dispatch.js";
import { createPluginRegistry } from "./registry.js";
import { definePluginCommand, type FoundationPlugin } from "./types.js";
import type { SmartDocument } from "../types.js";

/**
 * Before Phase 11 Tier 0, resolveShortcut/PluginRegistry existed and were
 * tested in isolation (dispatch.test.ts), but surface/input.ts - the real
 * keyboard controller - never called them, so a plugin registering a
 * shortcut had zero effect on a running editor
 * (docs/bugs/input-ts-not-wired-to-plugin-shortcut-dispatch.md). This test
 * proves the fix at the integration boundary input.ts now actually uses:
 * a synthetic, non-built-in plugin's shortcut contribution reaches
 * FoundationEditor.keyboardShortcuts, and dispatching a real key event
 * through resolveShortcut against editor.commands/editor.resolveScope
 * produces real operations - the same three calls surface/input.ts's Tab
 * handler makes today.
 */
const shoutPlugin: FoundationPlugin = {
  id: "third-party.shout",
  version: "1.0.0",
  commands: {
    "shout.exclaim": definePluginCommand({
      id: "shout.exclaim",
      run: (document, scope) => scope.kind === "block-range"
        ? [{ type: "insertText", pos: scope.range.to, text: "!" }]
        : [],
      description: "Inserts a literal exclamation mark at the caret.",
    }),
  },
  // Priority 999 - deliberately higher than any built-in Tab contribution,
  // so if this ever collided on the same key it would win the tie-break;
  // it uses its own key ("!") here precisely to prove registration and
  // dispatch work for a key no built-in plugin declares at all.
  keyboardShortcuts: [
    { id: "shout.exclaim", commandId: "shout.exclaim", key: "!", scopeKinds: ["block-range"], priority: 999 },
  ],
};

describe("a third-party plugin's registered shortcut has real effect once dispatched, not just registered", () => {
  it("reaches FoundationEditor.keyboardShortcuts/commands and produces real operations via the same resolveShortcut call surface/input.ts makes", () => {
    const registry = createPluginRegistry([...builtInPlugins, shoutPlugin], { baseSchema, schemaVersion: foundationRegistry.schema.version });
    const document: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] },
    ] };
    const editor = createFoundationEditor({
      document,
      selection: { type: "text", anchor: { path: [0], offset: 5 }, head: { path: [0], offset: 5 } },
      schema: registry.schema,
      commands: registry.commands,
      keyboardShortcuts: registry.keyboardShortcuts,
    });

    expect(editor.keyboardShortcuts.some((s) => s.id === "shout.exclaim")).toBe(true);
    expect(editor.commands.has("shout.exclaim")).toBe(true);

    const resolved = resolveShortcut(editor.keyboardShortcuts, { key: "!" }, (shortcut) => {
      const command = editor.commands.get(shortcut.commandId);
      if (!command) return null;
      const wanted = shortcut.scopeKinds[0];
      if (wanted === "mixed" || wanted === "empty") return null;
      const scope = editor.resolveScope({ want: wanted });
      if (!("kind" in scope) || scope.kind !== wanted) return null;
      return command.run(editor.document, scope, shortcut.params, { schema: editor.schema, positions: editor.positions });
    });

    expect(resolved?.shortcut.id).toBe("shout.exclaim");
    expect(resolved?.operations).toEqual([{ type: "insertText", pos: { path: [0], offset: 5 }, text: "!" }]);

    editor.transact((builder) => builder.operations.push(...resolved!.operations));
    expect((editor.document.children[0] as { children: { text: string }[] }).children[0].text).toBe("hello!");
  });
});
