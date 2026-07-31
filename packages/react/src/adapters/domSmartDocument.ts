import {
  normalizeCompatibilityHtml,
  sanitizeLinkAttrs,
  type SmartBlockNode,
  type SmartDocument,
  type SmartInlineNode,
  type SmartMark,
  type SmartTextNode,
  type TextAlignment,
} from "smartrte-core";
import { isEditorOnlyElement } from "./domSelectionBridge.js";

const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "table", "img", "video", "audio"]);

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
  if (element.hasAttribute("data-formula")) {
    marks = addMark(marks, { type: "formula", value: element.getAttribute("data-formula") || "" });
  }
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
  const fontFamily = (element as HTMLElement).style.fontFamily;
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
  if (fontFamily) marks = addMark(marks, { type: "fontFamily", value: fontFamily });
  return marks;
};

const inlineNodes = (nodes: NodeListOf<ChildNode> | ChildNode[], inherited: SmartMark[] = []): SmartInlineNode[] => {
  const result: SmartInlineNode[] = [];
  Array.from(nodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) result.push({ type: "text", text: node.textContent, marks: inherited.length ? inherited : undefined });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.hasAttribute("data-formula")) {
      result.push({
        type: "formula",
        value: node.getAttribute("data-formula") || "",
        ...(node.textContent && node.textContent !== node.getAttribute("data-formula")
          ? { displayText: node.textContent }
          : {}),
      });
      return;
    }
    if (node.tagName.toLowerCase() === "img") {
      result.push({
        type: "inlineImage",
        src: node.getAttribute("src") || "",
        alt: node.getAttribute("alt") || undefined,
        title: node.getAttribute("title") || undefined,
        width: Number(node.getAttribute("width")) || undefined,
        height: Number(node.getAttribute("height")) || undefined,
      });
      return;
    }
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

const indentFor = (element: Element) => {
  const margin = Number.parseFloat((element as HTMLElement).style.marginLeft || "0");
  return Number.isFinite(margin) && margin > 0 ? Math.min(Math.round(margin / 24), 10) : undefined;
};

const parseBlocks = (parent: Element): SmartBlockNode[] => directBlockChildren(parent).flatMap(parseBlock);

const parseList = (element: Element): SmartBlockNode => {
  const requestedStyle = (element as HTMLElement).style.listStyleType;
  const supportedStyles = new Set([
    "disc", "circle", "square", "decimal", "lower-alpha", "upper-alpha",
    "lower-roman", "upper-roman",
  ]);
  const fallbackStyle = element.tagName.toLowerCase() === "ol" ? "decimal" : "disc";
  const style = (supportedStyles.has(requestedStyle) ? requestedStyle : fallbackStyle) as
    Extract<SmartBlockNode, { type: "list" }>["style"];
  const items = Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((item) => {
      const content = paragraphFromDirectContent(item);
      const nested = Array.from(item.children)
        .filter((child) => ["ul", "ol", "blockquote", "pre", "table", "p", "h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName.toLowerCase()))
        .flatMap(parseBlock);
      return {
        type: "listItem" as const,
        alignment: alignmentFor(item),
        ...(item.hasAttribute("data-checked") || item.hasAttribute("data-srte-checked")
          ? { checked: (item.getAttribute("data-checked") || item.getAttribute("data-srte-checked")) === "true" }
          : {}),
        children: [...(content ? [content] : []), ...nested],
      };
    });
  const checklist = element.getAttribute("data-srte-checklist") === "true";
  return {
    type: "list",
    indent: indentFor(element),
    style,
    ...(checklist ? { checklist: true } : {}),
    ...(checklist && element.getAttribute("data-srte-checklist-strike") === "true"
      ? { strikeCompleted: true }
      : {}),
    children: items,
  };
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

const borderFor = (element: Element) => {
  const style = (element as HTMLElement).style;
  if (style.border) return style.border;
  const declared = element.getAttribute("style")?.match(/(?:^|;)\s*border\s*:\s*([^;]+)/i)?.[1]?.trim();
  if (declared) return declared;
  if (
    style.borderTopStyle === "none" &&
    style.borderRightStyle === "none" &&
    style.borderBottomStyle === "none" &&
    style.borderLeftStyle === "none"
  ) return "none";
  return undefined;
};

const parseTable = (element: Element): SmartBlockNode => ({
  type: "table",
  indent: indentFor(element),
  columnWidths: Array.from(element.querySelectorAll(":scope > colgroup > col"))
    .map((column) => Number.parseFloat((column as HTMLElement).style.width || column.getAttribute("width") || ""))
    .filter((width) => Number.isFinite(width) && width > 0),
  children: tableRows(element).map((row) => ({
    type: "tableRow",
    heightPx: Number.parseFloat((row as HTMLElement).style.height || "") || undefined,
    children: Array.from(row.children)
      .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
      .map((cell) => ({
        type: cell.tagName.toLowerCase() === "th" ? "tableHeaderCell" : "tableCell",
        colspan: Number(cell.getAttribute("colspan")) || undefined,
        rowspan: Number(cell.getAttribute("rowspan")) || undefined,
        backgroundColor: (cell as HTMLElement).style.backgroundColor || undefined,
        textColor: (cell as HTMLElement).style.color || undefined,
        border: borderFor(cell),
        children: parseBlocks(cell).length ? parseBlocks(cell) : [{ type: "paragraph", alignment: alignmentFor(cell), children: inlineNodes(cell.childNodes) }],
      })),
  })),
});

const parseBlock = (element: Element): SmartBlockNode[] => {
  const tag = element.tagName.toLowerCase();
  if (tag === "p") return [{ type: "paragraph", alignment: alignmentFor(element), indent: indentFor(element), children: inlineNodes(element.childNodes) }];
  if (/^h[1-6]$/.test(tag)) return [{ type: "heading", level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, alignment: alignmentFor(element), indent: indentFor(element), children: inlineNodes(element.childNodes) }];
  if (tag === "ul" || tag === "ol") return [parseList(element)];
  if (tag === "blockquote") return [{ type: "blockquote", alignment: alignmentFor(element), indent: indentFor(element), children: parseBlocks(element) }];
  if (tag === "pre") return [{ type: "codeBlock", alignment: alignmentFor(element), indent: indentFor(element), text: element.textContent || "", language: element.querySelector("code")?.className.replace(/^language-/, "") || undefined }];
  if (tag === "img") return [{
    type: "image",
    indent: indentFor(element),
    src: element.getAttribute("src") || "",
    alt: element.getAttribute("alt") || undefined,
    title: element.getAttribute("title") || undefined,
    width: Number(element.getAttribute("width")) || undefined,
    height: Number(element.getAttribute("height")) || undefined,
  }];
  if (tag === "video" || tag === "audio") return [{
    type: "media",
    indent: indentFor(element),
    src: element.getAttribute("src") || element.querySelector("source")?.getAttribute("src") || "",
    mediaType: tag,
    title: element.getAttribute("title") || undefined,
    mimeType: element.getAttribute("type") || element.querySelector("source")?.getAttribute("type") || undefined,
  }];
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
    if (mark.type === "fontFamily") html = `<span style="font-family:${escapeHtml(mark.value)}">${html}</span>`;
    if (mark.type === "formula") html = `<span data-formula="${escapeHtml(mark.value)}">${html}</span>`;
    if (mark.type === "link") html = `<a href="${escapeHtml(mark.href)}"${mark.target ? ` target="${escapeHtml(mark.target)}"` : ""}>${html}</a>`;
  });
  return html;
};

const serializeInline = (node: SmartInlineNode) => {
  if (node.type === "text") return serializeText(node);
  if (node.type === "formula") {
    return `<span data-formula="${escapeHtml(node.value)}">${escapeHtml(node.displayText ?? node.value)}</span>`;
  }
  return `<img data-srte-inline="true" src="${escapeHtml(node.src)}"${node.alt ? ` alt="${escapeHtml(node.alt)}"` : ""}${node.title ? ` title="${escapeHtml(node.title)}"` : ""}${node.width ? ` width="${node.width}"` : ""}${node.height ? ` height="${node.height}"` : ""}>`;
};

const blockStyleAttribute = (block: { alignment?: TextAlignment; indent?: number }, extra?: string) => {
  const declarations = [
    block.alignment ? `text-align:${block.alignment}` : "",
    block.indent ? `margin-left:${block.indent * 24}px` : "",
    extra || "",
  ].filter(Boolean);
  return declarations.length ? ` style="${declarations.join(";")}"` : "";
};

const alignmentAttribute = (alignment?: TextAlignment) => blockStyleAttribute({ alignment });

const serializeBlock = (block: SmartBlockNode): string => {
  if (block.type === "paragraph") return `<p${blockStyleAttribute(block)}>${block.children.map(serializeInline).join("")}</p>`;
  if (block.type === "heading") return `<h${block.level}${blockStyleAttribute(block)}>${block.children.map(serializeInline).join("")}</h${block.level}>`;
  if (block.type === "blockquote") return `<blockquote${blockStyleAttribute(block)}>${block.children.map(serializeBlock).join("")}</blockquote>`;
  if (block.type === "codeBlock") return `<pre${blockStyleAttribute(block)}><code${block.language ? ` class="language-${escapeHtml(block.language)}"` : ""}>${escapeHtml(block.text)}</code></pre>`;
  if (block.type === "image") return `<img${blockStyleAttribute(block)} src="${escapeHtml(block.src)}"${block.alt ? ` alt="${escapeHtml(block.alt)}"` : ""}${block.title ? ` title="${escapeHtml(block.title)}"` : ""}${block.width ? ` width="${block.width}"` : ""}${block.height ? ` height="${block.height}"` : ""}>`;
  if (block.type === "media") {
    const tag = block.mediaType === "audio" ? "audio" : "video";
    return `<${tag}${blockStyleAttribute(block)} controls src="${escapeHtml(block.src)}"${block.title ? ` title="${escapeHtml(block.title)}"` : ""}${block.mimeType ? ` type="${escapeHtml(block.mimeType)}"` : ""}></${tag}>`;
  }
  if (block.type === "list") {
    const ordered = ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"].includes(block.style);
    const tag = ordered ? "ol" : "ul";
    const style = blockStyleAttribute(block, `list-style-type:${block.style}`);
    const checklist = block.checklist
      ? ` data-srte-checklist="true" data-srte-checklist-strike="${block.strikeCompleted ? "true" : "false"}"`
      : "";
    return `<${tag}${style}${checklist}>${block.children.map((item) => `<li${item.checked !== undefined ? ` data-srte-checked="${item.checked ? "true" : "false"}"` : ""}${alignmentAttribute(item.alignment)}>${item.children.map(serializeBlock).join("")}</li>`).join("")}</${tag}>`;
  }
  const columns = block.columnWidths?.length
    ? `<colgroup>${block.columnWidths.map((width) => `<col style="width:${width}px">`).join("")}</colgroup>`
    : "";
  return `<table${blockStyleAttribute(block)}>${columns}<tbody>${block.children.map((row) => `<tr${row.heightPx ? ` style="height:${row.heightPx}px"` : ""}>${row.children.map((cell) => {
    const tag = cell.type === "tableHeaderCell" ? "th" : "td";
    const spans = `${cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ""}${cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ""}`;
    const style = [
      cell.backgroundColor ? `background-color:${escapeHtml(cell.backgroundColor)}` : "",
      cell.textColor ? `color:${escapeHtml(cell.textColor)}` : "",
      cell.border ? `border:${escapeHtml(cell.border)}` : "",
    ].filter(Boolean);
    return `<${tag}${spans}${style.length ? ` style="${style.join(";")}"` : ""}>${cell.children.map(serializeBlock).join("")}</${tag}>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
};

/** Serializes the shadow-only model. It is not used for persisted editor HTML. */
export const serializeSmartDocument = (document: SmartDocument) => document.children.map(serializeBlock).join("");
