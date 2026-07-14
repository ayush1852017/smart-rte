import { parseFragment, serialize } from "parse5";

type HtmlAttribute = { name: string; value: string };

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
  namespaceURI?: string;
};

export interface HtmlCompatibilityDocument {
  fragment: HtmlNode;
}

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "blockquote", "pre", "table", "div",
]);

const attrsOf = (node: HtmlNode) => node.attrs || [];
const hasAttr = (node: HtmlNode, name: string, value?: string) =>
  attrsOf(node).some((attr) => attr.name === name && (value == null || attr.value === value));

const isTag = (node: HtmlNode, tagName: string) => node.tagName === tagName;
const isWhitespaceText = (node: HtmlNode) => node.nodeName === "#text" && !(node as HtmlNode & { value?: string }).value?.trim();

const createParagraph = (children: HtmlNode[]): HtmlNode => ({
  nodeName: "p",
  tagName: "p",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  attrs: [],
  childNodes: children,
});

const normalizeTableCell = (cell: HtmlNode) => {
  const children = cell.childNodes || [];
  if (children.some((child) => child.tagName && BLOCK_TAGS.has(child.tagName))) return;

  const lines: HtmlNode[][] = [[]];
  children.forEach((child) => {
    if (isTag(child, "br")) {
      lines.push([]);
    } else {
      lines[lines.length - 1].push(child);
    }
  });
  const nonEmptyLines = lines.filter((line) => line.some((child) => !isWhitespaceText(child)));
  if (nonEmptyLines.length === 0) return;
  cell.childNodes = nonEmptyLines.map(createParagraph);
};

const normalizeNode = (node: HtmlNode) => {
  node.attrs = attrsOf(node).filter((attr) => {
    if (attr.name === "data-table-wrapper") return false;
    if (attr.name === "data-row-index" || attr.name === "data-col-index") return false;
    return !attr.name.startsWith("data-srte-");
  });

  if (!node.childNodes) return;
  const normalizedChildren: HtmlNode[] = [];
  node.childNodes.forEach((child) => {
    const isTableWrapper = hasAttr(child, "data-table-wrapper", "true");
    normalizeNode(child);
    if (isTableWrapper) {
      (child.childNodes || []).forEach((nested) => normalizedChildren.push(nested));
    } else {
      normalizedChildren.push(child);
    }
  });
  node.childNodes = normalizedChildren;
  if (isTag(node, "td") || isTag(node, "th")) normalizeTableCell(node);
};

/** Parses legacy HTML into a canonical, editor-UI-free compatibility document. */
export const parseCompatibilityHtml = (html: string): HtmlCompatibilityDocument => {
  const fragment = parseFragment(html) as unknown as HtmlNode;
  normalizeNode(fragment);
  return { fragment };
};

/** Serializes canonical compatibility HTML for persisted value/onChange output. */
export const serializeCompatibilityHtml = (document: HtmlCompatibilityDocument): string =>
  serialize(document.fragment as never);

export const normalizeCompatibilityHtml = (html: string): string =>
  serializeCompatibilityHtml(parseCompatibilityHtml(html));
