import type { BlockToolDeclaration } from "./types.js";
import type { Attrs } from "../types.js";

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
