import { definePluginCommand, type KeyboardShortcutContribution, type PluginCommand, type ToolbarContribution } from "../plugin/types.js";
import {
  indentBlockCommand, moveBlockCommand, outdentBlockCommand, setBlockAttributes,
  setBlockTypeCommand, unwrapBlocks, wrapBlocks,
} from "./commands.js";
import { indentInsideCodeBlock } from "./input.js";
import { blockToolDeclarations } from "./schema.js";

/**
 * Wraps the seven existing, already-tested block commands (block/commands.ts)
 * with the description Phase 10's doc generation needs.
 */
export const blockPluginCommands: Record<string, PluginCommand> = {
  "block.setType": definePluginCommand({
    id: "block.setType", run: setBlockTypeCommand,
    description: "Converts the selected blocks to a different type (paragraph, heading, or code block), preserving IDs and inline content where the target type allows it.",
    options: { type: { description: "The target block type.", required: true }, attrs: { description: "Attributes for the new type, e.g. heading level." } },
    examples: [{ description: "Convert the selection to a level-2 heading", params: { type: "heading", attrs: { level: 2 } } }],
  }),
  "block.wrap": definePluginCommand({
    id: "block.wrap", run: wrapBlocks,
    description: "Wraps the selected blocks in a blockquote, one wrapper per contiguous group.",
    options: { type: { description: "Currently only \"blockquote\".", required: true }, wrapperIds: { description: "Caller-provided ids, one per wrapper node created.", required: true } },
  }),
  "block.unwrap": definePluginCommand({
    id: "block.unwrap", run: unwrapBlocks,
    description: "Removes the enclosing blockquote (or other wrapper) from the selected blocks, promoting their content back out.",
  }),
  "block.setAttributes": definePluginCommand({
    id: "block.setAttributes", run: setBlockAttributes,
    description: "Sets attributes (e.g. alignment, indent level) on the selected blocks.",
    options: { attrs: { description: "The attributes to set.", required: true } },
    examples: [{ description: "Center-align the selected blocks", params: { attrs: { align: "center" } } }],
  }),
  "block.move": definePluginCommand({
    id: "block.move", run: moveBlockCommand,
    description: "Moves the selected contiguous blocks up or down among their siblings.",
    options: { direction: { description: "\"up\" or \"down\".", required: true } },
  }),
  "block.indent": definePluginCommand({
    id: "block.indent", run: indentBlockCommand,
    description: "Increases the selected blocks' indent level.",
    options: { amount: { description: "How many levels to indent by (default 1)." } },
  }),
  "block.outdent": definePluginCommand({
    id: "block.outdent", run: outdentBlockCommand,
    description: "Decreases the selected blocks' indent level.",
    options: { amount: { description: "How many levels to outdent by (default 1)." } },
  }),
  "block.code.indentTab": definePluginCommand({
    id: "block.code.indentTab", run: (document, scope) =>
      scope.kind === "block-range" ? indentInsideCodeBlock(document, scope.range.to)?.operations ?? [] : [],
    description: "Inserts a literal tab character at the caret when it is inside a code block; produces no operations otherwise.",
  }),
};

/**
 * Tab inside a code block always wins over list indent/outdent (priority
 * 20 > 10); Tab inside a list wins unless the caret is also in a table (the
 * list command itself has nothing to do outside a list-selection scope, so
 * it naturally yields); nothing is declared for table-grid, so Tab inside a
 * table falls through to native browser/table-cell navigation, unchanged.
 * This reproduces surface/input.ts's pre-Phase-11-Tier-0 hardcoded Tab
 * precedence, now data-driven - see plugin/dispatch.ts's resolveShortcut.
 */
export const blockPluginShortcuts: readonly KeyboardShortcutContribution[] = [
  { id: "block.code.indentTab", commandId: "block.code.indentTab", key: "Tab", scopeKinds: ["block-range"], priority: 20 },
];

/**
 * One toolbar contribution per blockToolDeclarations entry that needs no
 * caller-generated ids at invocation time (every "setType" and
 * "setAttributes" declaration - headings, paragraph, code block, and the
 * four alignments). The "wrapToggle" (blockquote) declaration needs fresh
 * wrapperIds per invocation, which a static toolbar contribution's params
 * cannot supply, so it is intentionally not represented here - a UI layer
 * invokes block.wrap directly once it has generated ids.
 */
export const blockToolbarContributions: readonly ToolbarContribution[] = blockToolDeclarations
  .filter((declaration) => declaration.kind === "setType" || declaration.kind === "setAttributes")
  .map((declaration) => ({
    id: `block.toolbar.${declaration.id}`,
    commandId: declaration.kind === "setType" ? "block.setType" : "block.setAttributes",
    params: declaration.kind === "setType" ? { type: declaration.type, attrs: "attrs" in declaration ? declaration.attrs : undefined } : { attrs: "attrs" in declaration ? declaration.attrs : undefined },
    label: declaration.id,
  }));
