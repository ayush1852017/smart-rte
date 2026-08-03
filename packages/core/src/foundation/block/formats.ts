import { isTextNode } from "../identity.js";
import {
  parseCanonicalListHtml,
  parseCanonicalListMarkdown,
  serializeCanonicalListHtml,
  serializeCanonicalListMarkdown,
} from "../list/formats.js";
import type { SmartDocument, SmartElementNode } from "../types.js";

export {
  parseCanonicalListHtml as parseCanonicalBlockHtml,
  parseCanonicalListMarkdown as parseCanonicalBlockMarkdown,
  serializeCanonicalListHtml as serializeCanonicalBlockHtml,
  serializeCanonicalListMarkdown as serializeCanonicalBlockMarkdown,
};

export interface CanonicalDocxBlock {
  readonly nodeId: string;
  readonly kind: "paragraph" | "heading" | "blockquote" | "code";
  readonly text: string;
  readonly style: string;
  readonly outlineLevel?: number;
  readonly alignment?: "left" | "center" | "right" | "justify";
  /** DOCX left indentation in twips (720 twips per canonical indent level). */
  readonly indentTwips?: number;
  readonly language?: string;
  readonly quoteDepth?: number;
}

const textOf = (node: SmartElementNode): string => (node.children || []).map((child) =>
  isTextNode(child) ? child.text : child.type === "hard_break" ? "\n" : "").join("");

/** Semantic DOCX mapping. Heading styles and paragraph properties are retained;
 * unsupported custom visual CSS is deliberately not transported. */
export const canonicalBlocksToDocx = (document: SmartDocument): CanonicalDocxBlock[] => {
  const output: CanonicalDocxBlock[] = [];
  const visit = (node: SmartElementNode, quoteDepth = 0) => {
    if (node.type === "blockquote") {
      (node.children || []).forEach((child) => { if (!isTextNode(child)) visit(child, quoteDepth + 1); });
      return;
    }
    if (!["paragraph", "heading", "code_block"].includes(node.type)) return;
    const level = node.type === "heading" ? Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)) : undefined;
    const alignment = typeof node.attrs?.align === "string" && ["left", "center", "right", "justify"].includes(node.attrs.align)
      ? node.attrs.align as CanonicalDocxBlock["alignment"] : undefined;
    const indentLevel = Math.max(0, Number(node.attrs?.indentLevel) || 0);
    output.push({
      nodeId: node.id,
      kind: node.type === "code_block" ? "code" : node.type === "heading" ? "heading" : "paragraph",
      text: textOf(node),
      style: node.type === "heading" ? `Heading${level}` : node.type === "code_block" ? "Code" : quoteDepth ? "Quote" : "Normal",
      ...(level ? { outlineLevel: level - 1 } : {}),
      ...(alignment ? { alignment } : {}),
      ...(indentLevel ? { indentTwips: indentLevel * 720 } : {}),
      ...(node.type === "code_block" && typeof node.attrs?.language === "string" ? { language: node.attrs.language } : {}),
      ...(quoteDepth ? { quoteDepth } : {}),
    });
  };
  document.children.forEach((node) => { if (!isTextNode(node)) visit(node); });
  return output;
};

/** PDF fidelity is visual-only; this deterministic text projection is used by
 * fixture tests and by render adapters as the non-destructive fallback. */
export const canonicalBlocksPdfText = (document: SmartDocument): string => canonicalBlocksToDocx(document)
  .map((block) => `${block.kind === "heading" ? `${"#".repeat((block.outlineLevel || 0) + 1)} ` : ""}${block.quoteDepth ? `${"> ".repeat(block.quoteDepth)}` : ""}${block.text}`)
  .join("\n");
