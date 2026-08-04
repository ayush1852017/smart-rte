import type { Attrs } from "../types.js";
import { safeFormulaSource, sanitizeAtomSource } from "./security.js";
import type { AtomDeclaration } from "./types.js";

const positiveDimensions = (attrs: Attrs) => [attrs.width, attrs.height].every((value) =>
  value === undefined || Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100_000);
const imageValid = (attrs: Attrs) => typeof attrs.alt === "string"
  && (attrs.alt.length > 0 || attrs.decorative === true)
  && positiveDimensions(attrs)
  && Boolean(sanitizeAtomSource(String(attrs.src || ""), { kind: "image", allowBlobPreview: attrs.status === "pending" }));
const formulaValid = (attrs: Attrs) => safeFormulaSource(attrs.source) && (attrs.notation === "latex" || attrs.notation === "mathml");
const mediaValid = (kind: "video" | "audio") => (attrs: Attrs) => positiveDimensions(attrs) && Boolean(sanitizeAtomSource(String(attrs.src || ""), { kind }));

export const atomDeclarations: readonly AtomDeclaration[] = [
  { type: "image", kind: "image", group: "inline", validate: imageValid },
  { type: "block_image", kind: "image", group: "block", validate: imageValid },
  { type: "formula", kind: "formula", group: "inline", validate: formulaValid },
  { type: "block_formula", kind: "formula", group: "block", validate: formulaValid },
  { type: "video", kind: "video", group: "block", validate: mediaValid("video") },
  { type: "audio", kind: "audio", group: "block", validate: mediaValid("audio") },
];
