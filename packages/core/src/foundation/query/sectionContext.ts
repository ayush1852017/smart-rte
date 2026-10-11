import { isTextNode } from "../identity.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartSelection } from "../types.js";

/**
 * Read-only document queries for host apps (1.2.0) - "which section is the
 * cursor in, and what does it say?" and "which images does this document
 * already have?". Pure functions of (document, selection); the React
 * runtime's getSectionContext/listImages are thin wrappers over these.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface SectionContext {
  /** Nearest top-level heading at or above the cursor, or null when the cursor precedes every heading. */
  heading: { id: string; level: HeadingLevel; text: string } | null;
  /** Plain text from that heading (exclusive) to the next top-level heading of the same or higher level. */
  text: string;
  /** True when `text` was cut to `maxChars`. */
  truncated: boolean;
}

export interface SectionContextOptions {
  /** Default 8000. */
  maxChars?: number;
}

export interface DocumentImageInfo {
  nodeId: string;
  src: string;
  alt: string;
  caption?: string;
  metadata?: Record<string, string>;
}

export const DEFAULT_SECTION_CONTEXT_MAX_CHARS = 8000;

const headingLevel = (node: SmartElementNode): HeadingLevel => {
  const level = Number(node.attrs?.level);
  return (Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1) as HeadingLevel;
};

const inlineText = (node: SmartElementNode): string => (node.children || []).map((child) =>
  isTextNode(child) ? child.text : child.type === "hard_break" ? "\n" : "").join("");

/**
 * Text extraction skips atoms, except that a captioned block image becomes
 * `[Figure: caption]` so a host sees the figures a section already has.
 * Tables become tab-separated cells, one row per line.
 */
const blockText = (node: SmartNode): string => {
  if (isTextNode(node)) return node.text;
  if (node.type === "paragraph" || node.type === "heading" || node.type === "code_block") return inlineText(node);
  if (node.type === "block_image") {
    return typeof node.attrs?.caption === "string" && node.attrs.caption ? `[Figure: ${node.attrs.caption}]` : "";
  }
  if (node.type === "table") {
    return (node.children || []).map((row) => isTextNode(row) ? ""
      : (row.children || []).map((cell) => isTextNode(cell) ? cell.text : childBlocksText(cell, " ")).join("\t")).join("\n");
  }
  if (node.type === "table_cell") return childBlocksText(node, " ");
  return childBlocksText(node, "\n");
};

const childBlocksText = (node: SmartElementNode, separator: string): string =>
  (node.children || []).map(blockText).filter((text) => text !== "").join(separator);

/**
 * Only top-level blocks start or end a section; a heading nested inside a
 * table, list or blockquote is ordinary text of the section it sits in.
 * With no meaningful cursor (`type: "none"` or an empty path) the start of
 * the document is used.
 */
export const getSectionContext = (
  document: SmartDocument,
  selection: SmartSelection | null | undefined,
  options: SectionContextOptions = {},
): SectionContext => {
  const blocks = document.children;
  const requested = Number(options.maxChars);
  const maxChars = Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : DEFAULT_SECTION_CONTEXT_MAX_CHARS;
  const cursor = selection && selection.type !== "none" && selection.head.path.length
    ? Math.min(Math.max(0, selection.head.path[0]), Math.max(0, blocks.length - 1))
    : 0;
  let headingIndex = -1;
  for (let index = cursor; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block && !isTextNode(block) && block.type === "heading") { headingIndex = index; break; }
  }
  const headingNode = headingIndex >= 0 ? blocks[headingIndex] as SmartElementNode : null;
  const level = headingNode ? headingLevel(headingNode) : 6;
  const parts: string[] = [];
  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    // With no heading above the cursor the "section" is the preamble, which
    // any heading ends.
    if (!isTextNode(block) && block.type === "heading" && headingLevel(block) <= level) break;
    const text = blockText(block);
    if (text !== "") parts.push(text);
  }
  const full = parts.join("\n\n");
  const truncated = full.length > maxChars;
  return {
    heading: headingNode ? { id: headingNode.id, level, text: inlineText(headingNode) } : null,
    text: truncated ? full.slice(0, maxChars) : full,
    truncated,
  };
};

/** Every inline `image` and `block_image`, in document order. */
export const listDocumentImages = (document: SmartDocument): DocumentImageInfo[] => {
  const images: DocumentImageInfo[] = [];
  const visit = (node: SmartNode) => {
    if (isTextNode(node)) return;
    if (node.type === "image" || node.type === "block_image") {
      const caption = typeof node.attrs?.caption === "string" && node.attrs.caption ? node.attrs.caption : undefined;
      const metadata = node.attrs?.metadata && typeof node.attrs.metadata === "object" && !Array.isArray(node.attrs.metadata)
        ? { ...(node.attrs.metadata as Record<string, string>) } : undefined;
      images.push({
        nodeId: node.id,
        src: String(node.attrs?.src || ""),
        alt: String(node.attrs?.alt || ""),
        ...(caption ? { caption } : {}),
        ...(metadata ? { metadata } : {}),
      });
    }
    node.children?.forEach(visit);
  };
  document.children.forEach(visit);
  return images;
};
