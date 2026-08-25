import { definePluginCommand, type KeyboardShortcutContribution, type PluginCommand } from "../plugin/types.js";
import {
  continueListNumbering, createList, indentList, moveListItems,
  outdentList, restartListNumbering, setListChecked, setListPreset, setListStyle, unwrapList,
} from "./commands.js";

/**
 * Wraps the ten existing, already-tested list commands (list/commands.ts)
 * with the description Phase 10's doc generation needs. list has no
 * per-item declaration layer the way block/marks/atom do (no single
 * "declaration" maps 1:1 to a toolbar button set) - list.setPreset's
 * `preset` param covers what a bulleted/numbered/checklist toolbar would
 * offer, so no separate toolbar-contribution list is built here.
 */
export const listPluginCommands: Record<string, PluginCommand> = {
  "list.create": definePluginCommand({
    id: "list.create", run: createList,
    description: "Wraps the selected blocks in a new list (or converts an existing list's items) using the given preset.",
    options: { preset: { description: "The list preset id, e.g. \"bulleted\" or \"numbered\"." } },
  }),
  "list.unwrap": definePluginCommand({
    id: "list.unwrap", run: unwrapList,
    description: "Removes the selected list items from their list, promoting their content back to plain blocks.",
  }),
  "list.indent": definePluginCommand({
    id: "list.indent", run: indentList,
    description: "Nests the selected list items one level deeper under the preceding sibling item.",
  }),
  "list.outdent": definePluginCommand({
    id: "list.outdent", run: outdentList,
    description: "Moves the selected list items one level shallower, or unwraps them entirely if already at the top level.",
  }),
  "list.setPreset": definePluginCommand({
    id: "list.setPreset", run: setListPreset,
    description: "Changes the selected list's preset (e.g. bulleted, numbered, checklist), restyling its markers accordingly.",
    options: { preset: { description: "The new preset id." } },
  }),
  "list.setStyle": definePluginCommand({
    id: "list.setStyle", run: setListStyle,
    description: "Changes the selected list's marker style (e.g. disc, decimal, lower-alpha) independent of its preset.",
  }),
  "list.setChecked": definePluginCommand({
    id: "list.setChecked", run: setListChecked,
    description: "Toggles a checklist item's checked state.",
    options: { checked: { description: "The new checked state.", required: true } },
  }),
  "list.move": definePluginCommand({
    id: "list.move", run: moveListItems,
    description: "Moves the selected list items up or down among their siblings.",
    options: { direction: { description: "\"up\" or \"down\".", required: true } },
  }),
  "list.restartNumbering": definePluginCommand({
    id: "list.restartNumbering", run: restartListNumbering,
    description: "Restarts an ordered list's numbering at the given value from this item onward.",
    options: { start: { description: "The number to restart counting from.", required: true } },
  }),
  "list.continueNumbering": definePluginCommand({
    id: "list.continueNumbering", run: continueListNumbering,
    description: "Removes an explicit numbering restart, letting this item continue the count from the preceding item.",
  }),
};

/**
 * Tab/Shift+Tab inside a list-selection scope, priority 10 - lower than
 * block's code-indent (20), so a code-block caret's Tab wins first (see
 * block/plugin.ts's blockPluginShortcuts); indentList/outdentList
 * themselves need a fresh id per invocation (nestedListIds/splitListIds),
 * which a static KeyboardShortcutContribution.params can't hold, so the
 * dispatch caller (surface/input.ts) generates it at invocation time, the
 * same way every other id-generating command call in this codebase already
 * does (e.g. CanonicalAuthorityEditor.tsx's table commands).
 */
export const listPluginShortcuts: readonly KeyboardShortcutContribution[] = [
  { id: "list.indent", commandId: "list.indent", key: "Tab", scopeKinds: ["list-selection"], priority: 10 },
  { id: "list.outdent", commandId: "list.outdent", key: "Tab", shift: true, scopeKinds: ["list-selection"], priority: 10 },
];
