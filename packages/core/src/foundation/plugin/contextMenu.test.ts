import { describe, expect, it } from "vitest";
import { foundationRegistry } from "../schema.js";
import { createPluginRegistry } from "./registry.js";
import { builtInPlugins } from "./builtins.js";

/**
 * Phase 11.5 §2.3 originally gave table/atom/marks all contextMenu
 * contributions (previously zero built-in plugins populated the field at
 * all). A later context-menu scope reduction made the menu table-only:
 * marks (already on the toolbar) and atom/link (moved to dedicated
 * overlays - MediaOverlay, and an auto-triggered LinkEditorPopover) no
 * longer register contextMenu contributions at all - only table does. The
 * underlying commands (mark.toggle, atom.delete, etc.) are unchanged and
 * still reachable via toolbar/the new overlays, just not via right-click.
 */
describe("built-in contextMenu contributions", () => {
  it("populates contextMenu for table only - marks and atom no longer contribute (moved to toolbar/dedicated overlays)", () => {
    const byPrefix = (prefix: string) => foundationRegistry.contextMenu.filter((c) => c.id.startsWith(prefix));
    expect(byPrefix("marks.contextMenu.").length).toBe(0);
    expect(byPrefix("table.contextMenu.").length).toBeGreaterThan(0);
    expect(byPrefix("atom.contextMenu.").length).toBe(0);
  });

  it("every contextMenu contribution references a real command id and declares a non-empty scopeKinds", () => {
    foundationRegistry.contextMenu.forEach((contribution) => {
      expect(foundationRegistry.commands.get(contribution.commandId)).toBeDefined();
      expect(contribution.scopeKinds.length).toBeGreaterThan(0);
    });
  });

  it("has no id collisions with toolbar/keyboardShortcuts, and registers cleanly end to end", () => {
    // createPluginRegistry throws on any duplicate contribution id across
    // toolbar/keyboardShortcuts/contextMenu (registry.ts's shared
    // contributionIds set) - rebuilding here (rather than only trusting the
    // module-load-time foundationRegistry) makes that assertion explicit.
    expect(() => createPluginRegistry(builtInPlugins, {
      baseSchema: { nodes: [{ type: "doc", group: "document", content: "block+" }, { type: "text", group: "inline", marks: "_all" }] },
      schemaVersion: 1,
    })).not.toThrow();
  });

  it("table.insertRow/insertColumn contributions carry only static params (position) - callers must merge in fresh ids", () => {
    const insertRow = foundationRegistry.contextMenu.find((c) => c.id === "table.contextMenu.insertRowBelow");
    expect(insertRow?.commandId).toBe("table.insertRow");
    expect(insertRow?.params).toEqual({ position: "after" });
    expect((insertRow?.params as { rowId?: unknown })?.rowId).toBeUndefined();
  });
});
