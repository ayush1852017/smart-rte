import type { BlockToolDeclaration } from "./types.js";
import type { Attrs, AttributeSpec, NodeSpec } from "../types.js";

const stringAttr: AttributeSpec = { validate: (value) => typeof value === "string" };
const alignmentAttr: AttributeSpec = { validate: (value) => ["left", "center", "right", "justify"].includes(String(value)) };
const indentLevelAttr: AttributeSpec = { validate: (value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10 };
/**
 * A unitless multiplier, matching CSS `line-height`'s own unitless mode
 * (e.g. `1.5` means "1.5x the element's own font size") - deliberately not
 * a fixed px/pt value, which would stop scaling correctly the moment
 * `fontSize` changes on the same block. Range is generous but bounded
 * (Google Docs' own preset list tops out at 2.5; 0.1-10 comfortably covers
 * every preset plus realistic custom values without accepting nonsense
 * like a negative multiplier). Absence of this attribute (not "1") means
 * "no override" - the block renders at the browser/font's own natural
 * line-height, exactly like `align`/`indentLevel` already work.
 */
const lineHeightAttr: AttributeSpec = { validate: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 10 };
const blockAttrs = { align: alignmentAttr, indentLevel: indentLevelAttr, lineHeight: lineHeightAttr };

/** Node specs owned by the block family - extracted out of foundation/schema.ts's previously hardcoded foundationSchema literal (Phase 10). */
export const blockNodeSpecs: readonly NodeSpec[] = [
  { type: "paragraph", group: "block", content: "inline*", attributes: blockAttrs },
  { type: "heading", group: "block", content: "inline*", attributes: { ...blockAttrs, level: { required: true, default: 1, validate: (v) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 6 } } },
  {
    type: "blockquote", group: "block", content: "block+", defining: true,
    // backgroundColor/textColor are plain CSS colour values, matching
    // table_cell's own background/textColor attrs. borderLeft stores one
    // composed CSS shorthand ("4px solid #0284c7") rather than separate
    // width/style/colour attrs - blockquote only ever shows a single
    // visible border side, so there's no per-side independence to
    // preserve the way table_cell's 4-sided borders need.
    attributes: { ...blockAttrs, backgroundColor: stringAttr, textColor: stringAttr, borderLeft: stringAttr },
  },
  { type: "code_block", group: "block", content: "text*", marks: "", attributes: { ...blockAttrs, language: stringAttr }, defining: true },
];

export const blockToolDeclarations = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `heading${index + 1}`,
    kind: "setType" as const,
    type: "heading" as const,
    attrs: { level: index + 1 },
    validate: (attrs: Attrs | undefined) => Number.isInteger(attrs?.level) && Number(attrs?.level) >= 1 && Number(attrs?.level) <= 6,
  })),
  { id: "paragraph", kind: "setType", type: "paragraph" },
  { id: "codeBlock", kind: "setType", type: "code_block" },
  { id: "blockquote", kind: "wrapToggle", type: "blockquote", nestable: true },
  { id: "alignLeft", kind: "setAttributes", attrs: { align: "left" } },
  { id: "alignCenter", kind: "setAttributes", attrs: { align: "center" } },
  { id: "alignRight", kind: "setAttributes", attrs: { align: "right" } },
  { id: "alignJustify", kind: "setAttributes", attrs: { align: "justify" } },
] as const satisfies readonly BlockToolDeclaration[];
