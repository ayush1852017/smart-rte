import type { MarkSpec, NodeSpec } from "../types.js";
import { normalizeLinkInput } from "../security/urlPolicy.js";
import { canonicalColor, canonicalFontFamily, canonicalFontSize } from "./canonical.js";
import type { InlineToolDeclaration } from "./types.js";

const stringValue = { required: true, validate: (value: unknown) => typeof value === "string" && Boolean(value) };
const numberValue = { required: true, validate: (value: unknown) => typeof value === "number" && Number.isFinite(value) };

export const inlineMarkSpecs = [
  { type: "bold", inclusive: true },
  { type: "italic", inclusive: true },
  { type: "underline", inclusive: true },
  { type: "strike", inclusive: true },
  { type: "code", inclusive: true },
  { type: "superscript", inclusive: true, excludes: ["subscript"] },
  { type: "subscript", inclusive: true, excludes: ["superscript"] },
  { type: "textColor", inclusive: true, excludes: ["textColor"], attributes: { value: stringValue } },
  { type: "backgroundColor", inclusive: true, excludes: ["backgroundColor"], attributes: { value: stringValue } },
  { type: "fontSize", inclusive: true, excludes: ["fontSize"], attributes: { valuePx: numberValue } },
  { type: "fontFamily", inclusive: true, excludes: ["fontFamily"], attributes: { value: stringValue } },
  { type: "link", inclusive: false, excludes: ["link"], attributes: {
    href: stringValue,
    target: { validate: (value: unknown) => typeof value === "string" && Boolean(value) },
  } },
] as const satisfies readonly MarkSpec[];

/** A hard break is one inline cursor unit and never carries marks itself. */
export const hardBreakNodeSpec = {
  type: "hard_break", group: "inline", atomic: true, selectable: false, marks: "",
} as const satisfies NodeSpec;

export const inlineToolDeclarations = [
  { id: "bold", markType: "bold", inclusive: true },
  { id: "italic", markType: "italic", inclusive: true },
  { id: "underline", markType: "underline", inclusive: true },
  { id: "strikethrough", markType: "strike", inclusive: true },
  { id: "inlineCode", markType: "code", inclusive: true },
  { id: "superscript", markType: "superscript", inclusive: true, excludes: ["subscript"] },
  { id: "subscript", markType: "subscript", inclusive: true, excludes: ["superscript"] },
  { id: "textColor", markType: "textColor", inclusive: true, excludes: ["textColor"], validate: (attrs) => canonicalColor(attrs?.value) !== null },
  { id: "backgroundColor", markType: "backgroundColor", inclusive: true, excludes: ["backgroundColor"], validate: (attrs) => canonicalColor(attrs?.value) !== null },
  { id: "fontSize", markType: "fontSize", inclusive: true, excludes: ["fontSize"], validate: (attrs) => canonicalFontSize(attrs?.valuePx) !== null },
  { id: "fontFamily", markType: "fontFamily", inclusive: true, excludes: ["fontFamily"], validate: (attrs) => canonicalFontFamily(attrs?.value) !== null },
  { id: "link", markType: "link", inclusive: false, excludes: ["link"], validate: (attrs) => normalizeLinkInput(String(attrs?.href || "")).href !== null },
] as const satisfies readonly InlineToolDeclaration[];
