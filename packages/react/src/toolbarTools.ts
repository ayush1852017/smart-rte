/**
 * A named, per-tool toolbar-visibility toggle - "developers should be able
 * to hide tools they don't want their users to see" (e.g. Version History,
 * Review, Video, Audio), without wrapping/overriding the component or
 * patching it with CSS. This is a UI-visibility layer, distinct from and
 * composed with (never replacing) two existing, deeper mechanisms:
 *
 * - `EditorCapabilityPreset` (capabilityPresets.ts) controls real document
 *   *capability* - which plugins the schema itself is built with (today,
 *   only `table`). Excluding a plugin there already, correctly, hides its
 *   toolbar entry (`tablesEnabled`) - this file does not duplicate that.
 * - Provider presence (`mediaProvider`, `versionProvider`, `commentProvider`,
 *   `suggestionProvider`) already gates whether a feature can function at
 *   all. `tools` never turns a tool ON when its required provider is
 *   absent - see `resolveToolbarTools`'s own doc comment.
 *
 * `tools` is for the remaining, larger set of toolbar entries that have no
 * other on/off mechanism at all today (Bold, Italic, Video, Audio, Special
 * characters, Version history, ...) - a host that wants to hide any of
 * these previously had no supported way to do so.
 *
 * Deliberately NOT covered by individual keys (scoping decision, not an
 * oversight): purely contextual actions that only ever act on something
 * already selected - block move/indent, list-item indent/move/restart
 * numbering, table row/column/cell operations, and the selected-media
 * edit/resize/delete actions. None of these have independent product
 * meaning (there is no real case for "let people insert a table but hide
 * its 'Add row' action") - they stay governed solely by their owning
 * top-level tool (`insertTable`, `bulletedList`/`numberedList`/`checklist`,
 * `link`, `image`/`video`/`audio`).
 */
export interface ToolbarTools {
  // Text formatting
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  superscript: boolean;
  subscript: boolean;
  textColor: boolean;
  backgroundColor: boolean;
  fontSize: boolean;
  fontFamily: boolean;
  // Paragraph
  /** The Paragraph/Heading 1-6/Code block <select>. */
  blockType: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
  alignJustify: boolean;
  quote: boolean;
  // Lists
  bulletedList: boolean;
  numberedList: boolean;
  checklist: boolean;
  /** The named multi-level marker preset picker (decimal/alpha/roman/outline/bullet-glyph) - independent of the plain list-type toggles above. */
  listPreset: boolean;
  // Insert
  link: boolean;
  removeLink: boolean;
  /** Requires `mediaProvider` to actually render - see resolveToolbarTools. */
  image: boolean;
  /** Requires `mediaProvider` to actually render - see resolveToolbarTools. */
  video: boolean;
  /** Requires `mediaProvider` to actually render - see resolveToolbarTools. */
  audio: boolean;
  insertFormula: boolean;
  specialCharacters: boolean;
  /** Requires the schema to actually have the table plugin (EditorCapabilityPreset) - see resolveToolbarTools. */
  insertTable: boolean;
  // Document
  import: boolean;
  saveAsHtml: boolean;
  saveAsMarkdown: boolean;
  saveAsWord: boolean;
  saveAsPdf: boolean;
  saveAsSmartRte: boolean;
  /** Requires `versionProvider` to actually render. */
  versionHistory: boolean;
  /** Bundles "Add comment" and the Comments panel toggle - requires `commentProvider` to actually render. */
  comments: boolean;
  /** Bundles Suggest insertion/deletion/removal, the Suggestions panel toggle, and "Show edits" (track changes) - requires `suggestionProvider` to actually render. */
  suggestions: boolean;
  // History
  undo: boolean;
  redo: boolean;
}

/** Every tool defaults to visible - an existing consumer who never passes `tools` sees 100% unchanged behavior. */
export const DEFAULT_TOOLBAR_TOOLS: ToolbarTools = {
  bold: true, italic: true, underline: true, strikethrough: true, code: true,
  superscript: true, subscript: true, textColor: true, backgroundColor: true, fontSize: true, fontFamily: true,
  blockType: true, alignLeft: true, alignCenter: true, alignRight: true, alignJustify: true, quote: true,
  bulletedList: true, numberedList: true, checklist: true, listPreset: true,
  link: true, removeLink: true, image: true, video: true, audio: true, insertFormula: true, specialCharacters: true, insertTable: true,
  import: true, saveAsHtml: true, saveAsMarkdown: true, saveAsWord: true, saveAsPdf: true, saveAsSmartRte: true,
  versionHistory: true, comments: true, suggestions: true,
  undo: true, redo: true,
};

/**
 * Merges a host's partial `tools` override onto the all-enabled default -
 * a host only ever needs to name the tools they want OFF.
 */
export const resolveToolbarTools = (tools?: Partial<ToolbarTools>): ToolbarTools => ({ ...DEFAULT_TOOLBAR_TOOLS, ...tools });
