import { definePluginCommand, type PluginCommand, type ToolbarContribution } from "../plugin/types.js";
import {
  clearAllMarksCommand, editLinkCommand, removeLinkCommand, removeMarkCommand,
  applyMarkCommand, setMarkAttrsCommand, toggleMarkCommand,
} from "./commands.js";
import { inlineMarkSpecs, inlineToolDeclarations } from "./schema.js";

/**
 * Wraps the seven existing, already-tested mark commands (marks/commands.ts)
 * with the description Phase 10's doc generation needs. The commands
 * themselves are unchanged - all are generic (apply/remove/toggle/setAttrs
 * to any mark type via a `markType` param), so individual marks like bold
 * or italic are not separate commands; they are toolbar/shortcut
 * contributions that invoke the same command with a different `params`.
 */
export const markPluginCommands: Record<string, PluginCommand> = {
  "mark.apply": definePluginCommand({
    id: "mark.apply", run: applyMarkCommand,
    description: "Applies a mark (e.g. bold, link) to the current inline selection, removing any mutually-excluded mark first.",
    options: { markType: { description: "The mark type to apply, e.g. \"bold\" or \"link\".", required: true }, attrs: { description: "Mark attributes, if the mark type requires any (e.g. link's href)." } },
  }),
  "mark.remove": definePluginCommand({
    id: "mark.remove", run: removeMarkCommand,
    description: "Removes a mark type from the current inline selection.",
    options: { markType: { description: "The mark type to remove.", required: true } },
  }),
  "mark.toggle": definePluginCommand({
    id: "mark.toggle", run: toggleMarkCommand,
    description: "Applies a mark, or removes it if the selection is already fully covered by it (params.coverage === \"all\").",
    options: {
      markType: { description: "The mark type to toggle.", required: true },
      attrs: { description: "Mark attributes, if the mark type requires any." },
      coverage: { description: "\"all\" when the selection is already fully covered by this mark - toggles it off instead of re-applying it." },
    },
    examples: [
      { description: "Toggle bold on the current selection", params: { markType: "bold" } },
      { description: "Toggle bold off, given the selection is already fully bold", params: { markType: "bold", coverage: "all" } },
    ],
  }),
  "mark.setAttrs": definePluginCommand({
    id: "mark.setAttrs", run: setMarkAttrsCommand,
    description: "Sets a mark's attributes on the current selection (an alias of mark.apply - re-applying overwrites existing attributes).",
    options: { markType: { description: "The mark type to update.", required: true }, attrs: { description: "The new attributes." } },
  }),
  "mark.clearAll": definePluginCommand({
    id: "mark.clearAll", run: clearAllMarksCommand,
    description: "Removes every mark present on the current inline selection, regardless of type.",
  }),
  "link.remove": definePluginCommand({
    id: "link.remove", run: removeLinkCommand,
    description: "Removes the link mark from the current selection, or from the link run at a collapsed caret inside one.",
  }),
  "link.edit": definePluginCommand({
    id: "link.edit", run: editLinkCommand,
    description: "Sets or replaces the link mark's href/target on the current selection, or on the link run at a collapsed caret inside one.",
    options: { href: { description: "The link URL.", required: true }, target: { description: "The link's target attribute, e.g. \"_blank\"." } },
    examples: [{ description: "Turn the selection into a link", params: { href: "https://example.com" } }],
  }),
};

/** One toolbar contribution per inlineToolDeclarations entry (schema.ts), each invoking mark.toggle with that mark's type as params. */
export const markToolbarContributions: readonly ToolbarContribution[] = inlineToolDeclarations.map((declaration) => ({
  id: `marks.toolbar.${declaration.id}`,
  commandId: "mark.toggle",
  params: { markType: declaration.markType, coverage: "partial" },
  label: declaration.id,
}));

export { inlineMarkSpecs };
