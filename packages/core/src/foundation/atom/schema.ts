import type { AttributeSpec, NodeSpec } from "../types.js";
import { normalizeLinkInput } from "../security/urlPolicy.js";

const optionalString: AttributeSpec = { validate: (value) => typeof value === "string" };
const requiredString: AttributeSpec = { required: true, validate: (value) => typeof value === "string" };
const dimension: AttributeSpec = { validate: (value) => Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100_000 };
const status: AttributeSpec = { default: "ready", validate: (value) => value === "pending" || value === "ready" || value === "error" };

const imageAttrs = {
  src: requiredString, alt: requiredString, width: dimension, height: dimension,
  status, uploadId: optionalString, error: optionalString, decorative: { validate: (value: unknown) => typeof value === "boolean" },
  align: { validate: (value: unknown) => value === "center" || value === "left" || value === "right" },
  /**
   * docs/bugs/media-details-old-editor-field-parity.md: the old editor's
   * "Link"/"Target" fields have no equivalent yet - the `link` mark already
   * has this exact href/target shape (marks/commands.ts), but marks are
   * explicitly disallowed on every atom node (`marks: ""` below), so this
   * is a dedicated pair of atom-level attrs instead of reusing the mark.
   */
  /** Same normalizeLinkInput validation the "link" mark's own schema uses (marks/schema.ts) - rejects at the command layer, not just sanitizing later at render/export time. */
  href: { validate: (value: unknown) => typeof value === "string" && normalizeLinkInput(value).href !== null },
  target: optionalString,
  /** Corner rounding (px) - confirmed absent anywhere in this schema before now, unlike align/alt/width which already existed with no UI. */
  borderRadius: { validate: (value: unknown) => Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 1_000 },
  /**
   * Mirrors MediaItem.license's own shape (packages/react/src/mediaProvider.ts)
   * field-for-field where a real equivalent exists, so a library-sourced
   * image's already-fetched license metadata can be copied straight across
   * at insert time (CanonicalAuthorityEditor.tsx's selectFromMediaManager)
   * instead of being read, shown in the library browser, and then silently
   * discarded the way it was before this - the atom schema had nowhere to
   * persist it. Renamed to this project's own vocabulary (the old editor's
   * "Attribution text" ~ MediaItem.license.author, "License description" ~
   * workName/licenseText) and kept independently user-editable, since a
   * freshly uploaded image has no provider-supplied license data at all.
   * `licenseVersion` has no MediaItem.license equivalent (its shape has no
   * separate version field) - always user-entered, never auto-populated.
   */
  licenseDescription: optionalString, licenseSourceUrl: optionalString,
  licenseType: optionalString, licenseVersion: optionalString, licenseAttribution: optionalString,
};
const formulaAttrs = {
  source: requiredString,
  notation: { required: true, default: "latex", validate: (value: unknown) => value === "latex" || value === "mathml" },
  error: optionalString,
};
const mediaAttrs = { src: requiredString, poster: optionalString, width: dimension, height: dimension, status, uploadId: optionalString, error: optionalString };

/** Inline and block variants are distinct because schema groups are static. */
export const atomNodeSpecs: readonly NodeSpec[] = [
  { type: "image", group: "inline", atomic: true, selectable: true, marks: "", attributes: imageAttrs },
  { type: "block_image", group: "block", atomic: true, selectable: true, marks: "", attributes: imageAttrs },
  { type: "formula", group: "inline", atomic: true, selectable: true, marks: "", attributes: formulaAttrs },
  { type: "block_formula", group: "block", atomic: true, selectable: true, marks: "", attributes: formulaAttrs },
  { type: "video", group: "block", atomic: true, selectable: true, marks: "", attributes: mediaAttrs },
  { type: "audio", group: "block", atomic: true, selectable: true, marks: "", attributes: mediaAttrs },
  // A horizontal rule (<hr>) - no content, no attrs, just a block-level
  // separator atom. Previously unrecognized entirely (parseBlock had no
  // case for "hr"), so every pasted <hr> fell to the generic
  // "unrecognized tag" fallback and rendered as "[Unsupported: hr]".
  { type: "divider", group: "block", atomic: true, selectable: true, marks: "" },
  // A print/export pagination marker - deliberately its own node type, not
  // a `divider` variant: a horizontal line is decorative content with no
  // export-time meaning beyond "draw a line," while a page break's entire
  // purpose is what happens at export/print time (real PDF pagination, a
  // DOCX page-break run, `break-before: page` in printed HTML) - see
  // atom/formats.ts's atomToPdf/atomToDocx and formats/docx/export.ts for
  // where that distinction actually matters. No content, no attrs, same as
  // divider.
  { type: "page_break", group: "block", atomic: true, selectable: true, marks: "" },
];
