import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./dispatch.js";
import type { KeyboardShortcutContribution } from "./types.js";
import type { SmartOperation } from "../types.js";

/**
 * surface/input.ts's real Tab handler (:1231) hardcodes this exact
 * precedence: a code block's own indent handler always wins when the
 * caret is inside one; otherwise a list item's indent/outdent wins unless
 * the description also reports being inside a table; otherwise Tab falls
 * through to table cell navigation / native browser behavior. These three
 * contributions, with declared scopeKinds and priority, reproduce that
 * precedence through resolveShortcut's fallback dispatch instead of an
 * if-chain hardcoded to one specific key - crucially, by actually trying
 * each candidate's command and advancing past one that doesn't apply
 * (not by pre-filtering on a single scope-kind label, which cannot tell
 * a code block apart from a plain paragraph).
 */
const codeIndent: KeyboardShortcutContribution = {
  id: "block.code.indentTab", commandId: "block.code.indentTab", key: "Tab", scopeKinds: ["block-range"], priority: 20,
};
const listIndent: KeyboardShortcutContribution = {
  id: "list.indent", commandId: "list.indent", key: "Tab", scopeKinds: ["list-selection"], priority: 10,
};
const listOutdent: KeyboardShortcutContribution = {
  id: "list.outdent", commandId: "list.outdent", key: "Tab", shift: true, scopeKinds: ["list-selection"], priority: 10,
};
const shortcuts = [codeIndent, listIndent, listOutdent];

const op: SmartOperation = { type: "insertText", pos: { path: [0], offset: 0 }, text: "x" };

/**
 * Simulates surface/input.ts's per-candidate applicability check: a
 * command "applies" (produces operations) only when the caret is actually
 * in the scope its contribution declares, exactly like indentInsideCodeBlock
 * returning null outside a code block, or indentList/outdentList having
 * nothing to do outside a list-selection scope.
 */
const tryShortcutIn = (activeScope: "code" | "list" | "table" | "plain") =>
  (shortcut: KeyboardShortcutContribution): readonly SmartOperation[] | null => {
    if (shortcut.commandId === "block.code.indentTab") return activeScope === "code" ? [op] : null;
    if (shortcut.commandId === "list.indent" || shortcut.commandId === "list.outdent") return activeScope === "list" ? [op] : null;
    return null;
  };

describe("resolveShortcut reproduces surface/input.ts's Tab precedence via fallback dispatch", () => {
  it("a code-block caret resolves to the code handler even though a list handler is also registered for Tab", () => {
    const result = resolveShortcut(shortcuts, { key: "Tab" }, tryShortcutIn("code"));
    expect(result?.shortcut).toBe(codeIndent);
    expect(result?.operations).toEqual([op]);
  });

  it("a list caret resolves to the list handler once the higher-priority code candidate reports it doesn't apply", () => {
    const result = resolveShortcut(shortcuts, { key: "Tab" }, tryShortcutIn("list"));
    expect(result?.shortcut).toBe(listIndent);
  });

  it("shift+Tab in a list resolves to outdent, not indent", () => {
    const result = resolveShortcut(shortcuts, { key: "Tab", shiftKey: true }, tryShortcutIn("list"));
    expect(result?.shortcut).toBe(listOutdent);
  });

  it("a table or plain-paragraph caret matches no applicable candidate, letting Tab fall through natively", () => {
    expect(resolveShortcut(shortcuts, { key: "Tab" }, tryShortcutIn("table"))).toBeNull();
    expect(resolveShortcut(shortcuts, { key: "Tab" }, tryShortcutIn("plain"))).toBeNull();
  });

  it("an unrelated key never matches regardless of scope", () => {
    expect(resolveShortcut(shortcuts, { key: "Enter" }, tryShortcutIn("list"))).toBeNull();
  });

  it("higher priority wins a genuine tie between two contributions that both apply", () => {
    const low: KeyboardShortcutContribution = { id: "a", commandId: "a", key: "k", scopeKinds: ["inline-range"], priority: 1 };
    const high: KeyboardShortcutContribution = { id: "b", commandId: "b", key: "k", scopeKinds: ["inline-range"], priority: 5 };
    // Registry output is expected pre-sorted by priority desc, then
    // registration order - resolveShortcut just tries them in that order.
    const sorted = [low, high].sort((l, r) => (r.priority ?? 0) - (l.priority ?? 0));
    const result = resolveShortcut(sorted, { key: "k" }, () => [op]);
    expect(result?.shortcut).toBe(high);
  });
});
