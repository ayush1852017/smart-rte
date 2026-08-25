import type { BlockToolDeclaration } from "./types.js";
import type { Attrs, AttributeSpec, NodeSpec } from "../types.js";

const stringAttr: AttributeSpec = { validate: (value) => typeof value === "string" };
const alignmentAttr: AttributeSpec = { validate: (value) => ["left", "center", "right", "justify"].includes(String(value)) };
const indentLevelAttr: AttributeSpec = { validate: (value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10 };
const blockAttrs = { align: alignmentAttr, indentLevel: indentLevelAttr };

/** Node specs owned by the block family - extracted out of foundation/schema.ts's previously hardcoded foundationSchema literal (Phase 10). */
export const blockNodeSpecs: readonly NodeSpec[] = [
  { type: "paragraph", group: "block", content: "inline*", attributes: blockAttrs },
  { type: "heading", group: "block", content: "inline*", attributes: { ...blockAttrs, level: { required: true, default: 1, validate: (v) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 6 } } },
  { type: "blockquote", group: "block", content: "block+", attributes: blockAttrs, defining: true },
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
