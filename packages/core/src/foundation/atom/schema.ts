import type { AttributeSpec, NodeSpec } from "../types.js";

const optionalString: AttributeSpec = { validate: (value) => typeof value === "string" };
const requiredString: AttributeSpec = { required: true, validate: (value) => typeof value === "string" };
const dimension: AttributeSpec = { validate: (value) => Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100_000 };
const status: AttributeSpec = { default: "ready", validate: (value) => value === "pending" || value === "ready" || value === "error" };

const imageAttrs = {
  src: requiredString, alt: requiredString, width: dimension, height: dimension,
  status, uploadId: optionalString, error: optionalString, decorative: { validate: (value: unknown) => typeof value === "boolean" },
  align: { validate: (value: unknown) => value === "center" || value === "left" || value === "right" },
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
];
