import {
  normalizeCompatibilityHtml,
  sanitizeLinkAttrs,
  type SmartBlockNode,
  type SmartDocument,
  type SmartMark,
  type SmartTextNode,
  type TextAlignment,
} from "smartrte-core";
import { isEditorOnlyElement } from "./domSelectionBridge.js";

const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "table"]);

const unwrap = (element: Element) => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
};

/** Removes editor UI before handing the document to the core parser boundary. */
export const cleanEditorHtml = (root: HTMLElement): string => {
  const clone = root.cloneNode(true) as HTMLElement;
  Array.from(clone.querySelectorAll<HTMLElement>("*")).forEach((element) => {
    if (element.getAttribute("data-table-wrapper") === "true") unwrap(element);
  });
  Array.from(clone.querySelectorAll<HTMLElement>("*")).forEach((element) => {
    if (isEditorOnlyElement(element)) element.remove();
  });
  return normalizeCompatibilityHtml(clone.innerHTML);
};

const addMark = (marks: SmartMark[], mark: SmartMark) =>
  marks.some((candidate) => candidate.type === mark.type) ? marks : [...marks, mark];

const marksFor = (element: Element, inherited: SmartMark[]): SmartMark[] => {
  const tag = element.tagName.toLowerCase();
  let marks = inherited;
  if (tag === "strong" || tag === "b") marks = addMark(marks, { type: "bold" });
  if (tag === "em" || tag === "i") marks = addMark(marks, { type: "italic" });
  if (tag === "u") marks = addMark(marks, { type: "underline" });
  if (tag === "s" || tag === "strike" || tag === "del") marks = addMark(marks, { type: "strike" });
  if (tag === "sup") marks = addMark(marks, { type: "superscript" });
  if (tag === "sub") marks = addMark(marks, { type: "subscript" });
  if (tag === "code") marks = addMark(marks, { type: "code" });
  if (tag === "a") {
    const safeLink = sanitizeLinkAttrs({
      href: element.getAttribute("href") || "",
      target: element.getAttribute("target") || undefined,
    });
    if (safeLink) marks = addMark(marks, { type: "link", ...safeLink });
  }
  const color = element.getAttribute("color") || (element as HTMLElement).style.color;
  const backgroundColor = (element as HTMLElement).style.backgroundColor;
  const fontSize = (element as HTMLElement).style.fontSize;
  if (color) marks = addMark(marks, { type: "textColor", value: color });
  if (backgroundColor) marks = addMark(marks, { type: "backgroundColor", value: backgroundColor });
  if (fontSize) {
    const match = /^([\d.]+)(px|pt)?$/i.exec(fontSize.trim());
    if (match) {
      const numeric = Number(match[1]);
      const valuePx = match[2]?.toLowerCase() === "pt" ? numeric * 4 / 3 : numeric;
      if (Number.isFinite(valuePx) && valuePx > 0) marks = addMark(marks, { type: "fontSize", valuePx });
    }
  }
  return marks;
};

const inlineNodes = (nodes: NodeListOf<ChildNode> | ChildNode[], inherited: SmartMark[] = []): SmartTextNode[] => {
  const result: SmartTextNode[] = [];
  Array.from(nodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) result.push({ type: "text", text: node.textContent, marks: inherited.length ? inherited : undefined });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName.toLowerCase() === "br") {
      result.push({ type: "text", text: "\n", marks: inherited.length ? inherited : undefined });
      return;
    }
    result.push(...inlineNodes(node.childNodes, marksFor(node, inherited)));
  });
  return result;
};

const directBlockChildren = (parent: Element): Element[] => {
  const children: Element[] = [];
  Array.from(parent.children).forEach((child) => {
    const tag = child.tagName.toLowerCase();
    if (blockTags.has(tag)) children.push(child);
    else children.push(...directBlockChildren(child));
  });
  return children;
};

const paragraphFromDirectContent = (element: Element) => {
  const inline = inlineNodes(
    Array.from(element.childNodes).filter((node) => !(node instanceof Element && blockTags.has(node.tagName.toLowerCase()))),
  );
  return inline.length ? { type: "paragraph" as const, alignment: alignmentFor(element), children: inline } : null;
};

const alignmentFor = (element: Element): TextAlignment | undefined => {
  const value = ((element as HTMLElement).style.textAlign || element.getAttribute("align") || "").toLowerCase();
  return value === "center" || value === "right" || value === "justify" ? value : undefined;
};

const parseBlocks = (parent: Element): SmartBlockNode[] => directBlockChildren(parent).flatMap(parseBlock);

const parseList = (element: Element): SmartBlockNode => {
  const style = element.tagName.toLowerCase() === "ol" ? "decimal" : "disc";
  const items = Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((item) => {
      const content = paragraphFromDirectContent(item);
      const nested = Array.from(item.children)
        .filter((child) => ["ul", "ol", "blockquote", "pre", "table", "p", "h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName.toLowerCase()))
        .flatMap(parseBlock);
      return { type: "listItem" as const, alignment: alignmentFor(item), children: [...(content ? [content] : []), ...nested] };
    });
  return { type: "list", style, children: items };
};

const tableRows = (table: Element) => {
  const rows: Element[] = [];
  Array.from(table.children).forEach((child) => {
    if (child.tagName.toLowerCase() === "tr") rows.push(child);
    else if (["thead", "tbody", "tfoot"].includes(child.tagName.toLowerCase())) {
      rows.push(...Array.from(child.children).filter((row) => row.tagName.toLowerCase() === "tr"));
    }
  });
  return rows;
};

const parseTable = (element: Element): SmartBlockNode => ({
  type: "table",
  children: tableRows(element).map((row) => ({
    type: "tableRow",
    children: Array.from(row.children)
      .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
      .map((cell) => ({
        type: cell.tagName.toLowerCase() === "th" ? "tableHeaderCell" : "tableCell",
        colspan: Number(cell.getAttribute("colspan")) || undefined,
        rowspan: Number(cell.getAttribute("rowspan")) || undefined,
        children: parseBlocks(cell).length ? parseBlocks(cell) : [{ type: "paragraph", alignment: alignmentFor(cell), children: inlineNodes(cell.childNodes) }],
      })),
  })),
});

const parseBlock = (element: Element): SmartBlockNode[] => {
  const tag = element.tagName.toLowerCase();
  if (tag === "p") return [{ type: "paragraph", alignment: alignmentFor(element), children: inlineNodes(element.childNodes) }];
  if (/^h[1-6]$/.test(tag)) return [{ type: "heading", level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, alignment: alignmentFor(element), children: inlineNodes(element.childNodes) }];
  if (tag === "ul" || tag === "ol") return [parseList(element)];
  if (tag === "blockquote") return [{ type: "blockquote", alignment: alignmentFor(element), children: parseBlocks(element) }];
  if (tag === "pre") return [{ type: "codeBlock", alignment: alignmentFor(element), text: element.textContent || "", language: element.querySelector("code")?.className.replace(/^language-/, "") || undefined }];
  if (tag === "table") return [parseTable(element)];
  return [];
};

export const smartDocumentFromHtml = (html: string, ownerDocument: Document): SmartDocument => {
  const container = ownerDocument.createElement("div");
  container.innerHTML = normalizeCompatibilityHtml(html);
  return { type: "doc", children: parseBlocks(container) };
};

export const smartDocumentFromEditorRoot = (root: HTMLElement): { document: SmartDocument; html: string } => {
  const html = cleanEditorHtml(root);
  return { document: smartDocumentFromHtml(html, root.ownerDocument), html };
};

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");

const serializeText = (node: SmartTextNode) => {
  let html = escapeHtml(node.text).replace(/\n/g, "<br>");
  (node.marks || []).forEach((mark) => {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    if (mark.type === "italic") html = `<em>${html}</em>`;
    if (mark.type === "underline") html = `<u>${html}</u>`;
    if (mark.type === "strike") html = `<s>${html}</s>`;
    if (mark.type === "superscript") html = `<sup>${html}</sup>`;
    if (mark.type === "subscript") html = `<sub>${html}</sub>`;
    if (mark.type === "code") html = `<code>${html}</code>`;
    if (mark.type === "textColor") html = `<span style="color:${escapeHtml(mark.value)}">${html}</span>`;
    if (mark.type === "backgroundColor") html = `<span style="background-color:${escapeHtml(mark.value)}">${html}</span>`;
    if (mark.type === "fontSize") html = `<span style="font-size:${mark.valuePx}px">${html}</span>`;
    if (mark.type === "link") html = `<a href="${escapeHtml(mark.href)}"${mark.target ? ` target="${escapeHtml(mark.target)}"` : ""}>${html}</a>`;
  });
  return html;
};

const alignmentAttribute = (alignment?: TextAlignment) => alignment ? ` style="text-align:${alignment}"` : "";

const serializeBlock = (block: SmartBlockNode): string => {
  if (block.type === "paragraph") return `<p${alignmentAttribute(block.alignment)}>${block.children.map(serializeText).join("")}</p>`;
  if (block.type === "heading") return `<h${block.level}${alignmentAttribute(block.alignment)}>${block.children.map(serializeText).join("")}</h${block.level}>`;
  if (block.type === "blockquote") return `<blockquote${alignmentAttribute(block.alignment)}>${block.children.map(serializeBlock).join("")}</blockquote>`;
  if (block.type === "codeBlock") return `<pre${alignmentAttribute(block.alignment)}><code${block.language ? ` class="language-${escapeHtml(block.language)}"` : ""}>${escapeHtml(block.text)}</code></pre>`;
  if (block.type === "list") {
    const tag = block.style === "decimal" ? "ol" : "ul";
    return `<${tag}>${block.children.map((item) => `<li${alignmentAttribute(item.alignment)}>${item.children.map(serializeBlock).join("")}</li>`).join("")}</${tag}>`;
  }
  return `<table><tbody>${block.children.map((row) => `<tr>${row.children.map((cell) => `<${cell.type === "tableHeaderCell" ? "th" : "td"}>${cell.children.map(serializeBlock).join("")}</${cell.type === "tableHeaderCell" ? "th" : "td"}>`).join("")}</tr>`).join("")}</tbody></table>`;
};

/** Serializes the shadow-only model. It is not used for persisted editor HTML. */
export const serializeSmartDocument = (document: SmartDocument) => document.children.map(serializeBlock).join("");
