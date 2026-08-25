import { blockNodeSpecs } from "../block/schema.js";
import { blockPluginCommands, blockPluginShortcuts, blockToolbarContributions } from "../block/plugin.js";
import { listNodeSpecs } from "../list/schema.js";
import { listPluginCommands, listPluginShortcuts } from "../list/plugin.js";
import { tableNodeSpecs } from "../table/schema.js";
import { tablePluginCommands, tableContextMenuContributions } from "../table/plugin.js";
import { atomNodeSpecs } from "../atom/schema.js";
import { atomPluginCommands } from "../atom/plugin.js";
import { markPluginCommands, markToolbarContributions, inlineMarkSpecs } from "../marks/plugin.js";
import type { FoundationPlugin } from "./types.js";

/**
 * One FoundationPlugin per built-in feature family. Each is filled in as
 * that family is converted (Phase 10 tasks: marks -> list -> block ->
 * table -> atom) - wrapping its existing, already-tested command functions
 * with the required description/examples metadata, not rewriting them.
 * Families not yet converted still contribute their schema (so foundationSchema
 * stays complete) with an empty command set.
 */
export const builtInPlugins: readonly FoundationPlugin[] = [
  {
    id: "marks", version: "1.0.0", schema: { marks: inlineMarkSpecs }, commands: markPluginCommands,
    toolbar: markToolbarContributions,
  },
  { id: "list", version: "1.0.0", schema: { nodes: listNodeSpecs }, commands: listPluginCommands, keyboardShortcuts: listPluginShortcuts },
  { id: "block", version: "1.0.0", schema: { nodes: blockNodeSpecs }, commands: blockPluginCommands, toolbar: blockToolbarContributions, keyboardShortcuts: blockPluginShortcuts },
  { id: "table", version: "1.0.0", schema: { nodes: tableNodeSpecs }, commands: tablePluginCommands, contextMenu: tableContextMenuContributions },
  { id: "atom", version: "1.0.0", schema: { nodes: atomNodeSpecs }, commands: atomPluginCommands },
];
