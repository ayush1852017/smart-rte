import { isTextNode } from "../identity.js";
import type { SmartDocument, SmartMark, SmartNode } from "../types.js";
import { canonicalMarkOrder } from "./canonical.js";

export const MARKDOWN_SUPPORTED_MARKS = Object.freeze(["bold", "italic", "code", "strike", "link"] as const);
export const MARKDOWN_UNSUPPORTED_MARKS = Object.freeze([
  "underline", "textColor", "backgroundColor", "fontSize", "fontFamily", "superscript", "subscript",
] as const);

export interface CanonicalDocxRunProperties {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly code?: boolean;
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly fontSizeHalfPoints?: number;
  readonly fontFamily?: string;
  readonly link?: { href: string; target?: string };
}

export interface CanonicalDocxRun {
  readonly text: string;
  readonly properties: CanonicalDocxRunProperties;
}

export const docxProperties = (marks: readonly SmartMark[]): CanonicalDocxRunProperties => {
  const properties: Record<string, unknown> = {};
  canonicalMarkOrder(marks).forEach((mark) => {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "strike"
      || mark.type === "code" || mark.type === "superscript" || mark.type === "subscript") properties[mark.type] = true;
    else if (mark.type === "textColor") properties.color = mark.attrs?.value;
    else if (mark.type === "backgroundColor") properties.backgroundColor = mark.attrs?.value;
    else if (mark.type === "fontSize") properties.fontSizeHalfPoints = Math.round(Number(mark.attrs?.valuePx || 0) * 1.5);
    else if (mark.type === "fontFamily") properties.fontFamily = mark.attrs?.value;
    else if (mark.type === "link") properties.link = { href: String(mark.attrs?.href || ""), ...(mark.attrs?.target ? { target: String(mark.attrs.target) } : {}) };
  });
  return properties;
};

/**
 * The per-node half of docxProperties, matching FeatureFormatCodec.serialize's
 * (node, ctx) => unknown shape (formats/codec.ts) - Phase 11 Tier 2's marks
 * codec slice. Real single-node function already existed (docxProperties
 * operates on one text node's marks array already); this only adapts its
 * signature to accept a SmartNode directly, it does not add new logic.
 */
export const markRunDocxProperties = (node: SmartNode): CanonicalDocxRunProperties =>
  isTextNode(node) ? docxProperties(node.marks || []) : {};

/** Semantic DOCX run model. Conversion to OOXML lives in the product adapter. */
export const canonicalMarksToDocxRuns = (document: SmartDocument): CanonicalDocxRun[] => {
  const runs: CanonicalDocxRun[] = [];
  const visit = (node: SmartNode) => {
    if (isTextNode(node)) runs.push({ text: node.text, properties: docxProperties(node.marks || []) });
    else if (node.type === "hard_break") runs.push({ text: "\n", properties: {} });
    else node.children?.forEach(visit);
  };
  visit(document);
  return runs;
};

/** PDF fidelity is visual/lossy; this payload deliberately contains no mark identity. */
export const canonicalMarksPdfText = (document: SmartDocument): string =>
  canonicalMarksToDocxRuns(document).map((run) => run.text).join("");
