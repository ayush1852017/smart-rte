import { definePluginCommand, type PluginCommand } from "../plugin/types.js";
import { atomCommands } from "./commands.js";
import { atomDeclarations } from "./declarations.js";

/**
 * Wraps the four existing, already-tested atom commands (atom/commands.ts)
 * with the description Phase 10's doc generation needs. Six atom node
 * types (image, block_image, formula, block_formula, video, audio, per
 * atomDeclarations) share these same four generic commands via
 * `declaration`/`attrs` params, the same way marks' seven commands cover
 * every mark type - there is no per-atom-type command to convert
 * separately.
 *
 * MediaProvider/mediaPicker (packages/react/src/mediaProvider.ts) are left
 * exactly as they are - direct CanonicalAuthorityEditor props, already
 * working - rather than routed through this manifest. They are a
 * react-layer upload/picker concern orthogonal to the core command surface
 * atom.insert consumes (a MediaProvider's job ends at producing a URL;
 * atom.insert takes it from there like any other src).
 */
export const atomPluginCommands: Record<string, PluginCommand> = {
  "atom.insert": definePluginCommand({
    id: "atom.insert", run: atomCommands["atom.insert"],
    description: "Inserts an atom node (image, formula, video, or audio) at the given position.",
    options: {
      declaration: { description: "Which atom type to insert, from atomDeclarations (schema.ts).", required: true },
      nodeId: { description: "Caller-provided id for the new node.", required: true },
      attrs: { description: "The new node's attributes (e.g. src, alt for an image).", required: true },
      ownerId: { description: "The inline container to insert into - required for inline atoms." },
      offset: { description: "The inline offset to insert at." },
      parentId: { description: "The block container to insert into - required for block atoms." },
      index: { description: "The block index to insert at." },
    },
  }),
  "atom.update": definePluginCommand({
    id: "atom.update", run: atomCommands["atom.update"],
    description: "Updates the selected atom's attributes.",
    options: { attrs: { description: "The new attributes.", required: true } },
  }),
  "atom.delete": definePluginCommand({
    id: "atom.delete", run: atomCommands["atom.delete"],
    description: "Deletes the selected atom.",
  }),
  "atom.resize": definePluginCommand({
    id: "atom.resize", run: atomCommands["atom.resize"],
    description: "Resizes the selected atom, optionally preserving its aspect ratio.",
    options: {
      width: { description: "The new width.", required: true },
      height: { description: "The new height.", required: true },
      minWidth: { description: "A minimum width to clamp to." },
      minHeight: { description: "A minimum height to clamp to." },
      preserveAspectRatio: { description: "Whether to scale height proportionally to width (or vice versa)." },
    },
  }),
};

export { atomDeclarations };
