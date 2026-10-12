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
  /**
   * Whether the user placed the caret this context was read from (1.3.0).
   * Set by the editor handle's getSectionContext, which tracks user input;
   * the pure function here cannot know and leaves it out. When false, the
   * caret is the editor's default (document start), not a user choice.
   */
  caretSetByUser?: boolean;
}

/** A section of the document, started by a top-level heading (1.3.0). */
export interface DocumentSection {
  /** The top-level heading's node id. */
  headingId: string;
  level: HeadingLevel;
  /** The heading's plain text. */
  text: string;
  /** 0-based order among top-level headings. */
  index: number;
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

/**
 * Every top-level heading in document order - the same headings
 * getSectionContext treats as section starts. Headings nested inside
 * tables, lists or blockquotes don't start a section.
 */
export const listSections = (document: SmartDocument): DocumentSection[] => {
  const sections: DocumentSection[] = [];
  document.children.forEach((block) => {
    if (isTextNode(block) || block.type !== "heading") return;
    sections.push({ headingId: block.id, level: headingLevel(block), text: inlineText(block), index: sections.length });
  });
  return sections;
};

/**
 * The document-root child index at which content appended to a section
 * belongs: just before the next top-level heading of the same or higher
 * level (a smaller or equal number), or the end of the document if there
 * is none. `null` means the preamble - the part before the first top-level
 * heading - which ends at the first heading of any level. Returns null when
 * `headingId` isn't a top-level heading.
 */
export const sectionEndIndex = (document: SmartDocument, headingId: string | null): number | null => {
  const blocks = document.children;
  let start = -1;
  let level = 6;
  if (headingId !== null) {
    start = blocks.findIndex((block) => !isTextNode(block) && block.type === "heading" && block.id === headingId);
    if (start < 0) return null;
    level = headingLevel(blocks[start] as SmartElementNode);
  }
  for (let index = start + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!isTextNode(block) && block.type === "heading" && headingLevel(block) <= level) return index;
  }
  return blocks.length;
};

/** The document-root child index of a top-level block, or null if `nodeId` isn't a direct child of the document. */
export const topLevelIndexOf = (document: SmartDocument, nodeId: string): number | null => {
  const index = document.children.findIndex((block) => !isTextNode(block) && block.id === nodeId);
  return index < 0 ? null : index;
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
