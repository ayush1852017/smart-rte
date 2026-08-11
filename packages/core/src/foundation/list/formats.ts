import { parseFragment, serializeOuter } from "parse5";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { createNodeId, isTextNode } from "../identity.js";
import { canonicalMarkAttrs, canonicalMarkOrder } from "../marks/canonical.js";
import type { SmartDocument, SmartElementNode, SmartMark, SmartNode } from "../types.js";
import { occupancyGridFor } from "../table/grid.js";
import { atomToHtml } from "../atom/formats.js";
import { sanitizeAtomSource } from "../atom/security.js";
import { foundationListStyleForPresetDepth, isFoundationSmartListPreset } from "./presets.js";

type HtmlAttribute = { name: string; value: string };
type HtmlNode = { nodeName: string; tagName?: string; attrs?: HtmlAttribute[]; childNodes?: HtmlNode[]; value?: string };

const escapeHtml = (value: unknown) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (node: HtmlNode, name: string) => node.attrs?.find((candidate) => candidate.name === name)?.value;
const generatedId = (node: HtmlNode, prefix: string) => attr(node, "data-smart-id") || `${prefix}-${createNodeId()}`;
const isEditorUiNode = (node: HtmlNode) =>
  attr(node, "data-smart-ui") !== undefined || attr(node, "data-srte-check") !== undefined;

const serializeInline = (node: SmartNode): string => {
  if (!isTextNode(node)) {
    if (node.type === "hard_break") return `<br data-smart-id="${escapeHtml(node.id)}" data-smart-type="hard_break">`;
    if (["image", "formula"].includes(node.type)) return atomToHtml(node);
    const raw = node.attrs?.raw as { html?: unknown } | undefined;
    if (typeof raw?.html === "string") return raw.html;
    return `<span data-smart-id="${escapeHtml(node.id)}" data-smart-atomic="true">￼</span>`;
  }
  let html = escapeHtml(node.text);
  [...canonicalMarkOrder(node.marks)].reverse().forEach((mark) => {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "code") html = `<code>${html}</code>`;
    else if (mark.type === "superscript") html = `<sup>${html}</sup>`;
    else if (mark.type === "subscript") html = `<sub>${html}</sub>`;
    else if (mark.type === "textColor") html = `<span style="color:${escapeHtml(mark.attrs?.value || "")}">${html}</span>`;
    else if (mark.type === "backgroundColor") html = `<span style="background-color:${escapeHtml(mark.attrs?.value || "")}">${html}</span>`;
    else if (mark.type === "fontSize") html = `<span style="font-size:${escapeHtml(mark.attrs?.valuePx || "")}px">${html}</span>`;
    else if (mark.type === "fontFamily") html = `<span style="font-family:${escapeHtml(mark.attrs?.value || "")}">${html}</span>`;
    else if (mark.type === "link") html = `<a href="${escapeHtml(mark.attrs?.href || "")}"${mark.attrs?.target ? ` target="${escapeHtml(mark.attrs.target)}"` : ""}>${html}</a>`;
  });
  return html;
};

const orderedList = (node: SmartElementNode) => {
  const marker = String(node.attrs?.style || node.attrs?.preset || "");
  return /^(?:decimal|lower-|upper-|ordered)/.test(marker) || node.attrs?.start !== undefined;
};

const effectiveStyle = (node: SmartElementNode, depth: number): string | undefined => {
  if (typeof node.attrs?.style === "string") return node.attrs.style;
  return isFoundationSmartListPreset(node.attrs?.preset)
    ? foundationListStyleForPresetDepth(node.attrs.preset, depth)
    : undefined;
};

const blockAttributes = (node: SmartElementNode): string => {
  const declarations = [
    typeof node.attrs?.htmlStyle === "string" ? node.attrs.htmlStyle.replace(/;\s*$/, "") : "",
    typeof node.attrs?.align === "string" ? `text-align:${node.attrs.align}` : "",
    Number(node.attrs?.indentLevel) > 0 ? `margin-inline-start:${Number(node.attrs?.indentLevel) * 2}em` : "",
  ].filter(Boolean);
  return [
    node.attrs?.align ? ` data-smart-align="${escapeHtml(node.attrs.align)}"` : "",
    Number(node.attrs?.indentLevel) > 0 ? ` data-smart-indent="${escapeHtml(node.attrs?.indentLevel)}"` : "",
    declarations.length ? ` style="${escapeHtml(declarations.join(";"))}"` : "",
  ].join("");
};

const serializeBlock = (node: SmartElementNode, includeIds: boolean, listDepth = 0, tableCellA11y?: { id?: string; scope?: "row" | "col"; headers?: string }): string => {
  if (node.type === "unknown") {
    const raw = node.attrs?.raw as { html?: unknown } | undefined;
    if (typeof raw?.html === "string") return raw.html;
  }
  const id = includeIds ? ` data-smart-id="${escapeHtml(node.id)}"` : "";
  if (["block_image", "block_formula", "video", "audio"].includes(node.type)) return atomToHtml(node);
  if (node.type === "paragraph" || node.type === "heading") {
    const tag = node.type === "heading" ? `h${String(node.attrs?.level || 1)}` : "p";
    return `<${tag}${id}${blockAttributes(node)}>${(node.children || []).map(serializeInline).join("")}</${tag}>`;
  }
  if (node.type === "blockquote") {
    return `<blockquote${id}${blockAttributes(node)}>${(node.children || []).map((child) => isTextNode(child) ? serializeInline(child) : serializeBlock(child, includeIds, listDepth)).join("")}</blockquote>`;
  }
  if (node.type === "code_block") {
    const language = typeof node.attrs?.language === "string" && node.attrs.language ? node.attrs.language : undefined;
    const languageAttrs = language
      ? ` data-smart-language="${escapeHtml(language)}"><code class="language-${escapeHtml(language)}"`
      : "><code";
    const text = (node.children || []).map((child) => isTextNode(child) ? child.text : child.type === "hard_break" ? "\n" : "").join("");
    return `<pre${id}${blockAttributes(node)}${languageAttrs}>${escapeHtml(text)}</code></pre>`;
  }
  if (node.type === "table") {
    const grid = occupancyGridFor(node);
    let headerRows = 0;
    while (headerRows < grid.rows && Array.from({ length: grid.columns }, (_, column) => grid.at(headerRows, column)?.node.attrs?.header === true).every(Boolean)) headerRows += 1;
    let headerColumns = 0;
    while (headerColumns < grid.columns && Array.from({ length: grid.rows }, (_, row) => grid.at(row, headerColumns)?.node.attrs?.header === true).every(Boolean)) headerColumns += 1;
    const headerIds = new Map(grid.anchors.filter((cell) => cell.node.attrs?.header === true).map((cell) => [cell.cellId, `smart-header-${node.id}-${cell.cellId}`]));
    const cellA11y = (cell: SmartElementNode) => {
      const anchor = grid.anchors.find((candidate) => candidate.cellId === cell.id);
      if (!anchor) return {};
      if (cell.attrs?.header === true) return { id: headerIds.get(cell.id), scope: anchor.left < headerColumns && anchor.top >= headerRows ? "row" as const : "col" as const };
      const headers = grid.anchors.filter((header) => header.node.attrs?.header === true && (
        header.top < headerRows && header.left <= anchor.left && header.right > anchor.left
        || header.left < headerColumns && header.top <= anchor.top && header.bottom > anchor.top
      )).map((header) => headerIds.get(header.cellId)).filter((value): value is string => Boolean(value));
      return headers.length ? { headers: headers.join(" ") } : {};
    };
    const widths = Array.isArray(node.attrs?.columnWidths) ? node.attrs.columnWidths as unknown[] : [];
    const colgroup = widths.length ? `<colgroup>${widths.map((width) => `<col style="width:${escapeHtml(width)}px">`).join("")}</colgroup>` : "";
    const caption = typeof node.attrs?.caption === "string" && node.attrs.caption ? `<caption>${escapeHtml(node.attrs.caption)}</caption>` : "";
    const layout = node.attrs?.layout ? ` data-smart-layout="${escapeHtml(node.attrs.layout)}" style="table-layout:${escapeHtml(node.attrs.layout)}"` : "";
    const rows = (node.children || []).map((row) => isTextNode(row) ? "" : `<tr${includeIds ? ` data-smart-id="${escapeHtml(row.id)}"` : ""}${Number(row.attrs?.height) > 0 ? ` style="height:${Number(row.attrs?.height)}px"` : ""}>${(row.children || []).map((cell) => isTextNode(cell) ? "" : serializeBlock(cell, includeIds, listDepth, cellA11y(cell))).join("")}</tr>`).join("");
    return `<table${id}${layout}>${caption}${colgroup}<tbody>${rows}</tbody></table>`;
  }
  if (node.type === "table_row") {
    const height = Number(node.attrs?.height);
    return `<tr${id}${Number.isFinite(height) && height > 0 ? ` style="height:${height}px"` : ""}>${(node.children || []).map((child) => isTextNode(child) ? "" : serializeBlock(child, includeIds, listDepth)).join("")}</tr>`;
  }
  if (node.type === "table_cell") {
    const tag = node.attrs?.header === true ? "th" : "td";
    const rowspan = Math.max(1, Number(node.attrs?.rowspan) || 1);
    const colspan = Math.max(1, Number(node.attrs?.colspan) || 1);
    const styles = [
      node.attrs?.background ? `background:${String(node.attrs.background)}` : "",
      node.attrs?.textColor ? `color:${String(node.attrs.textColor)}` : "",
      node.attrs?.borders ? `border:${String(node.attrs.borders)}` : "",
      node.attrs?.verticalAlign ? `vertical-align:${String(node.attrs.verticalAlign)}` : "",
    ].filter(Boolean).join(";");
    return `<${tag}${id}${tableCellA11y?.id ? ` id="${escapeHtml(tableCellA11y.id)}"` : ""}${tableCellA11y?.scope ? ` scope="${tableCellA11y.scope}"` : ""}${tableCellA11y?.headers ? ` headers="${escapeHtml(tableCellA11y.headers)}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${colspan > 1 ? ` colspan="${colspan}"` : ""}${styles ? ` style="${escapeHtml(styles)}"` : ""}>${(node.children || []).map((child) => isTextNode(child) ? serializeInline(child) : serializeBlock(child, includeIds, listDepth)).join("")}</${tag}>`;
  }
  if (node.type === "list") {
    const tag = orderedList(node) ? "ol" : "ul";
    const style = effectiveStyle(node, listDepth);
    const attrs = [
      id,
      node.attrs?.preset ? ` data-smart-list-preset="${escapeHtml(node.attrs.preset)}" data-srte-list-preset="${escapeHtml(node.attrs.preset)}" data-srte-list-depth="${listDepth}"` : "",
      node.attrs?.style ? ` data-smart-list-style="${escapeHtml(node.attrs.style)}"` : "",
      style ? ` style="list-style-type:${escapeHtml(style)}"` : "",
      node.attrs?.start !== undefined ? ` start="${escapeHtml(node.attrs.start)}"` : "",
      node.attrs?.checkable === true ? ` data-smart-checkable="true" data-srte-checklist="true"` : "",
    ].join("");
    return `<${tag}${attrs}>${(node.children || []).map((child) => isTextNode(child) ? "" : serializeBlock(child, includeIds, listDepth)).join("")}</${tag}>`;
  }
  if (node.type === "list_item") {
    const attrs = [
      id,
      node.attrs?.checked !== undefined ? ` data-smart-checked="${node.attrs.checked === true ? "true" : "false"}" data-checked="${node.attrs.checked === true ? "true" : "false"}"` : "",
      typeof node.attrs?.htmlStyle === "string" ? ` style="${escapeHtml(node.attrs.htmlStyle)}"` : "",
      node.attrs?.numberOverride !== undefined ? ` value="${escapeHtml(node.attrs.numberOverride)}"` : "",
    ].join("");
    return `<li${attrs}>${(node.children || []).map((child) => isTextNode(child) ? serializeInline(child) : serializeBlock(child, includeIds, child.type === "list" ? listDepth + 1 : listDepth)).join("")}</li>`;
  }
  return `<div${id}>${(node.children || []).map((child) => isTextNode(child) ? serializeInline(child) : serializeBlock(child, includeIds)).join("")}</div>`;
};

export const serializeCanonicalListHtml = (document: SmartDocument, options: { clean?: boolean; fragment?: boolean } = {}): string =>
  options.clean === true
    ? document.children.map((node) => isTextNode(node) ? serializeInline(node) : serializeBlock(node, false)).join("")
      .replace(/\sdata-smart-id=(?:"[^"]*"|'[^']*')/g, "")
    : options.fragment === true
      ? document.children.map((node) => isTextNode(node) ? serializeInline(node) : serializeBlock(node, true)).join("")
      : `<div data-smart-document="true" data-smart-id="${escapeHtml(document.id)}">${document.children.map((node) => isTextNode(node) ? serializeInline(node) : serializeBlock(node, true)).join("")}</div>`;

const textWithMarks = (node: HtmlNode, inherited: readonly SmartMark[] = []): SmartNode[] => {
  if (isEditorUiNode(node)) return [];
  if (node.nodeName === "#text") return node.value ? [{ type: "text", text: node.value, ...(inherited.length ? { marks: [...inherited] } : {}) }] : [];
  const tag = node.tagName || "";
  if (tag === "br" || attr(node, "data-smart-type") === "hard_break") return [{
    type: "hard_break", id: generatedId(node, "break"),
  }];
  const declaredAtom = attr(node, "data-smart-type");
  if (tag === "img" || declaredAtom === "image" || declaredAtom === "formula") {
    if (declaredAtom === "formula") return [{ type: "formula", id: generatedId(node, "formula"), attrs: { source: attr(node, "data-smart-formula") || rawText(node), notation: attr(node, "data-smart-notation") === "mathml" ? "mathml" : "latex" } }];
    const src = sanitizeAtomSource(attr(node, "src"), { kind: "image", allowBlobPreview: attr(node, "data-smart-status") === "pending" });
    if (src) {
      const width = Number(attr(node, "width")); const height = Number(attr(node, "height"));
      return [{ type: "image", id: generatedId(node, "image"), attrs: {
        src, alt: attr(node, "alt") || "", status: attr(node, "data-smart-status") || "ready",
        ...(attr(node, "data-smart-decorative") === "true" ? { decorative: true } : {}),
        ...(attr(node, "title") ? { title: attr(node, "title") } : {}),
        ...(attr(node, "data-smart-align") ? { align: attr(node, "data-smart-align") } : {}),
        ...(Number.isFinite(width) && width > 0 ? { width } : {}), ...(Number.isFinite(height) && height > 0 ? { height } : {}),
      } }];
    }
  }
  if (attr(node, "data-smart-atomic") === "true") return [{
    type: "unknown", id: generatedId(node, "atom"),
    attrs: { originalType: attr(node, "data-smart-unknown-type") || tag || "inline-atom", originalGroup: "inline", raw: { html: serializeOuter(node as never) }, editable: false },
  }];
  let marks = [...inherited];
  const push = (mark: SmartMark | null) => { if (mark) marks.push(mark); };
  if (tag === "strong" || tag === "b") push({ type: "bold" });
  if (tag === "em" || tag === "i") push({ type: "italic" });
  if (tag === "u") push({ type: "underline" });
  if (tag === "s" || tag === "strike" || tag === "del") push({ type: "strike" });
  if (tag === "code") push({ type: "code" });
  if (tag === "sup") push({ type: "superscript" });
  if (tag === "sub") push({ type: "subscript" });
  if (tag === "a") push({ type: "link", attrs: {
    href: attr(node, "href") || "",
    ...(attr(node, "target") ? { target: attr(node, "target") } : {}),
  } });
  const declared = attr(node, "data-smart-mark");
  if (declared && !marks.some((mark) => mark.type === declared)) {
    const raw = attr(node, "data-smart-mark-attrs");
    try { push({ type: declared, ...(raw ? { attrs: JSON.parse(raw) as Record<string, unknown> } : {}) }); } catch { /* invalid metadata is ignored */ }
  }
  const color = styleValue(node, "color");
  const background = styleValue(node, "background-color");
  const size = styleValue(node, "font-size");
  const family = styleValue(node, "font-family");
  const attributed: Array<[string, Record<string, unknown>]> = [
    ...(color ? [["textColor", { value: color }] as [string, Record<string, unknown>]] : []),
    ...(background ? [["backgroundColor", { value: background }] as [string, Record<string, unknown>]] : []),
    ...(size ? [["fontSize", { valuePx: size }] as [string, Record<string, unknown>]] : []),
    ...(family ? [["fontFamily", { value: family }] as [string, Record<string, unknown>]] : []),
  ];
  attributed.forEach(([type, attrs]) => {
    const canonical = canonicalMarkAttrs(type, attrs);
    if (canonical && !marks.some((mark) => mark.type === type)) push({ type, attrs: canonical });
  });
  marks = canonicalMarkOrder(marks);
  return (node.childNodes || []).flatMap((child) => textWithMarks(child, marks));
};

const elementChildren = (node: HtmlNode) => (node.childNodes || []).filter((child) => Boolean(child.tagName) && !isEditorUiNode(child));
const styleValue = (node: HtmlNode, property: string) => attr(node, "style")?.split(";").map((part) => part.split(":"))
  .find(([name]) => name?.trim().toLowerCase() === property)?.[1]?.trim();

const withoutListMarkerStyle = (style: string | undefined): string | undefined => {
  if (!style) return undefined;
  const retained = style.split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !/^list-style(?:-type)?\s*:/i.test(declaration));
  return retained.length ? retained.join(";") : undefined;
};

const parsedBlockAttrs = (node: HtmlNode): Record<string, unknown> => {
  const attrs: Record<string, unknown> = {};
  const align = attr(node, "data-smart-align") || styleValue(node, "text-align");
  const explicitIndent = Number(attr(node, "data-smart-indent"));
  const legacyIndent = styleValue(node, "margin-left");
  const logicalIndent = styleValue(node, "margin-inline-start");
  const cssIndent = legacyIndent || logicalIndent;
  const computedIndent = cssIndent?.endsWith("px") ? Number.parseFloat(cssIndent) / 24
    : cssIndent?.endsWith("em") ? Number.parseFloat(cssIndent) / 2 : 0;
  const indent = Number.isFinite(explicitIndent) && explicitIndent > 0 ? explicitIndent : computedIndent;
  if (align && ["left", "center", "right", "justify"].includes(align)) attrs.align = align;
  if (Number.isInteger(indent) && indent > 0) attrs.indentLevel = indent;
  return attrs;
};

const rawText = (node: HtmlNode): string => node.nodeName === "#text" ? node.value || ""
  : node.tagName === "br" ? "\n"
    : (node.childNodes || []).filter((child) => !isEditorUiNode(child)).map(rawText).join("");

const parseBlock = (node: HtmlNode): SmartElementNode | null => {
  const tag = node.tagName || "";
  const declaredAtom = attr(node, "data-smart-type");
  if (declaredAtom === "block_image") {
    const src = sanitizeAtomSource(attr(node, "src"), { kind: "image" });
    return src ? { type: "block_image", id: generatedId(node, "image"), attrs: { src, alt: attr(node, "alt") || "", status: attr(node, "data-smart-status") || "ready", ...(attr(node, "data-smart-decorative") === "true" ? { decorative: true } : {}) } } : null;
  }
  if (declaredAtom === "block_formula") return { type: "block_formula", id: generatedId(node, "formula"), attrs: { source: attr(node, "data-smart-formula") || rawText(node), notation: attr(node, "data-smart-notation") === "mathml" ? "mathml" : "latex" } };
  if (tag === "video" || tag === "audio") {
    const src = sanitizeAtomSource(attr(node, "src"), { kind: tag });
    return src ? { type: tag, id: generatedId(node, tag), attrs: { src, status: "ready", ...(tag === "video" && attr(node, "poster") ? { poster: attr(node, "poster") } : {}) } } : null;
  }
  if (tag === "p" || /^h[1-6]$/.test(tag)) return {
    type: tag === "p" ? "paragraph" : "heading",
    id: generatedId(node, tag),
    ...((tag !== "p" || Object.keys(parsedBlockAttrs(node)).length) ? { attrs: {
      ...(tag !== "p" ? { level: Number(tag.slice(1)) } : {}),
      ...parsedBlockAttrs(node),
    } } : {}),
    children: (node.childNodes || []).flatMap((child) => textWithMarks(child)),
  };
  if (tag === "blockquote") {
    const children = elementChildren(node).flatMap((child) => {
      const parsed = parseBlock(child);
      return parsed ? [parsed] : [];
    });
    return {
      type: "blockquote", id: generatedId(node, "quote"),
      ...(Object.keys(parsedBlockAttrs(node)).length ? { attrs: parsedBlockAttrs(node) } : {}),
      children: children.length ? children : [{ type: "paragraph", id: createNodeId(), children: [] }],
    };
  }
  if (tag === "pre") {
    const code = elementChildren(node).find((child) => child.tagName === "code");
    const language = attr(node, "data-smart-language")
      || attr(code || node, "data-smart-language")
      || attr(code || node, "class")?.split(/\s+/).find((value) => value.startsWith("language-"))?.slice(9);
    const attrs = { ...parsedBlockAttrs(node), ...(language ? { language } : {}) };
    const text = rawText(code || node);
    return {
      type: "code_block", id: generatedId(node, "code"),
      ...(Object.keys(attrs).length ? { attrs } : {}),
      children: text ? [{ type: "text", text }] : [],
    };
  }
  if (tag === "table") {
    const rowNodes = elementChildren(node).flatMap((child) => child.tagName === "tr" ? [child]
      : ["thead", "tbody", "tfoot"].includes(child.tagName || "") ? elementChildren(child).filter((candidate) => candidate.tagName === "tr") : []);
    const columns = elementChildren(node).find((child) => child.tagName === "colgroup");
    const columnWidths = columns ? elementChildren(columns).filter((child) => child.tagName === "col").map((col) => {
      const width = Number.parseFloat(styleValue(col, "width") || attr(col, "width") || "");
      return Number.isFinite(width) && width > 0 ? width : 120;
    }) : [];
    const captionNode = elementChildren(node).find((child) => child.tagName === "caption");
    const tableAttrs: Record<string, unknown> = {};
    if (columnWidths.length) tableAttrs.columnWidths = columnWidths;
    const caption = captionNode ? rawText(captionNode).trim() : "";
    if (caption) tableAttrs.caption = caption;
    const layout = attr(node, "data-smart-layout") || styleValue(node, "table-layout");
    if (layout) tableAttrs.layout = layout;
    const rows = rowNodes.map((rowNode) => parseBlock(rowNode)).filter((row): row is SmartElementNode => Boolean(row));
    return { type: "table", id: generatedId(node, "table"), ...(Object.keys(tableAttrs).length ? { attrs: tableAttrs } : {}), children: rows };
  }
  if (tag === "tr") {
    const height = Number.parseFloat(styleValue(node, "height") || attr(node, "height") || "");
    const cells = elementChildren(node).filter((child) => child.tagName === "td" || child.tagName === "th")
      .map((cell) => parseBlock(cell)).filter((cell): cell is SmartElementNode => Boolean(cell));
    return { type: "table_row", id: generatedId(node, "row"), ...(Number.isFinite(height) && height > 0 ? { attrs: { height } } : {}), children: cells };
  }
  if (tag === "td" || tag === "th") {
    const cellAttrs: Record<string, unknown> = {
      rowspan: Math.max(1, Number(attr(node, "rowspan")) || 1),
      colspan: Math.max(1, Number(attr(node, "colspan")) || 1),
      header: tag === "th",
    };
    const background = styleValue(node, "background") || styleValue(node, "background-color");
    const borders = styleValue(node, "border");
    const textColor = styleValue(node, "color");
    const verticalAlign = styleValue(node, "vertical-align");
    if (background) cellAttrs.background = background;
    if (borders) cellAttrs.borders = borders;
    if (textColor) cellAttrs.textColor = textColor;
    if (verticalAlign) cellAttrs.verticalAlign = verticalAlign;
    const blockTags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "table"];
    const children = elementChildren(node).filter((child) => blockTags.includes(child.tagName || ""))
      .map((child) => parseBlock(child)).filter((child): child is SmartElementNode => Boolean(child));
    const directInline = (node.childNodes || []).filter((child) => !child.tagName || !blockTags.includes(child.tagName)).flatMap((child) => textWithMarks(child));
    if (directInline.length) children.unshift({ type: "paragraph", id: createNodeId(), children: directInline });
    if (!children.length) children.push({ type: "paragraph", id: createNodeId(), children: [] });
    return { type: "table_cell", id: generatedId(node, "cell"), attrs: cellAttrs, children };
  }
  if (tag === "ul" || tag === "ol") {
    const listAttrs: Record<string, unknown> = {};
    const requestedPreset = attr(node, "data-smart-list-preset") || attr(node, "data-srte-list-preset");
    const preset = isFoundationSmartListPreset(requestedPreset) ? requestedPreset : undefined;
    const explicitStyle = attr(node, "data-smart-list-style");
    const style = explicitStyle || (!preset ? styleValue(node, "list-style-type") : undefined) || (!preset ? (tag === "ol" ? "decimal" : "disc") : undefined);
    const start = Number(attr(node, "start"));
    if (preset) listAttrs.preset = preset;
    if (style) listAttrs.style = style;
    if (Number.isInteger(start) && start >= 1) listAttrs.start = start;
    if (attr(node, "data-smart-checkable") === "true" || attr(node, "data-srte-checklist") === "true") listAttrs.checkable = true;
    const items: SmartElementNode[] = [];
    elementChildren(node).forEach((child) => {
      if (child.tagName === "li") {
        const parsed = parseBlock(child);
        if (parsed) items.push(parsed);
      } else if ((child.tagName === "ul" || child.tagName === "ol") && items.length) {
        const nested = parseBlock(child);
        if (nested) {
          const last = items[items.length - 1];
          items[items.length - 1] = { ...last, children: [...(last.children || []), nested] };
        }
      }
    });
    return { type: "list", id: generatedId(node, "list"), attrs: listAttrs, children: items.length ? items : [{ type: "list_item", id: createNodeId(), children: [{ type: "paragraph", id: createNodeId(), children: [] }] }] };
  }
  if (tag === "li") {
    const attrs: Record<string, unknown> = {};
    const checked = attr(node, "data-smart-checked") || attr(node, "data-srte-checked") || attr(node, "data-checked");
    const value = Number(attr(node, "value"));
    if (checked !== undefined) attrs.checked = checked === "true";
    const htmlStyle = withoutListMarkerStyle(attr(node, "style"));
    if (htmlStyle) attrs.htmlStyle = htmlStyle;
    if (Number.isInteger(value) && value >= 1) attrs.numberOverride = value;
    const children: SmartElementNode[] = [];
    const blockTags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "div", "table", "figure"];
    const inlineNodes = (node.childNodes || []).filter((child) => !child.tagName || !blockTags.includes(child.tagName));
    const directText = inlineNodes.flatMap((child) => textWithMarks(child));
    if (directText.length) children.push({ type: "paragraph", id: createNodeId(), children: directText });
    elementChildren(node).forEach((child) => {
      const parsed = parseBlock(child);
      if (parsed) children.push(parsed);
    });
    if (!children.length) children.push({ type: "paragraph", id: createNodeId(), children: [] });
    return { type: "list_item", id: generatedId(node, "item"), ...(Object.keys(attrs).length ? { attrs } : {}), children };
  }
  if (tag) return {
    type: "unknown", id: generatedId(node, "unknown"),
    attrs: { originalType: attr(node, "data-smart-unknown-type") || tag, originalGroup: "block", raw: { html: serializeOuter(node as never) }, editable: false },
  };
  return null;
};

export const parseCanonicalListHtml = (html: string): SmartDocument => {
  const fragment = parseFragment(html) as unknown as HtmlNode;
  const wrapper = elementChildren(fragment).find((node) => attr(node, "data-smart-document") === "true");
  const source = wrapper || fragment;
  const children = elementChildren(source).flatMap((node) => {
    const parsed = parseBlock(node);
    return parsed ? [parsed] : [];
  });
  return { type: "doc", id: attr(source, "data-smart-id") || createNodeId(), children: children.length ? children : [{ type: "paragraph", id: createNodeId(), children: [] }] };
};

const plainText = (node: SmartElementNode) => (node.children || []).map((child) => isTextNode(child) ? child.text : child.type === "hard_break" ? "\n" : "").join("");
const markdownInlineText = (node: SmartElementNode): string => (node.children || []).map((child) => {
  if (!isTextNode(child)) return child.type === "hard_break" ? "  \n" : "";
  let value = child.text;
  [...canonicalMarkOrder(child.marks)].reverse().forEach((mark) => {
    if (mark.type === "code") value = `\`${value}\``;
    else if (mark.type === "bold") value = `**${value}**`;
    else if (mark.type === "italic") value = `*${value}*`;
    else if (mark.type === "strike") value = `~~${value}~~`;
    else if (mark.type === "link") value = `[${value}](${String(mark.attrs?.href || "")})`;
  });
  return value;
}).join("");
const markdownList = (list: SmartElementNode, depth: number): string[] => (list.children || []).flatMap((child, index) => {
  if (isTextNode(child)) return [];
  const content = (child.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type !== "list");
  const marker = orderedList(list) ? `${Number(list.attrs?.start || 1) + index}.` : "-";
  const task = list.attrs?.checkable === true ? `[${child.attrs?.checked === true ? "x" : " "}] ` : "";
  const indentation = "    ".repeat(depth);
  const line = `${indentation}${marker} ${task}${content[0] ? markdownInlineText(content[0]) : ""}`;
  const continuation = content.slice(1).flatMap((block) => ["", `${indentation}    ${markdownInlineText(block)}`]);
  const nested = (child.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type === "list")
    .flatMap((node) => markdownList(node, depth + 1));
  return [line, ...continuation, ...nested];
});

const markdownBlock = (node: SmartElementNode): string[] => {
  if (node.type === "list") return markdownList(node, 0);
  if (node.type === "heading") return [`${"#".repeat(Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)))} ${markdownInlineText(node)}`];
  if (node.type === "code_block") {
    const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
    return [`\`\`\`${language}\n${plainText(node)}\n\`\`\``];
  }
  if (node.type === "blockquote") {
    const content = (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child))
      .flatMap(markdownBlock).join("\n");
    return [content.split("\n").map((line) => `> ${line}`).join("\n")];
  }
  if (node.type === "table") {
    const rows = (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child) && child.type === "table_row");
    const logical = rows.map((row) => (row.children || []).filter((child): child is SmartElementNode => !isTextNode(child) && child.type === "table_cell")
      .flatMap((cell) => [markdownInlineText((cell.children || []).find((child): child is SmartElementNode => !isTextNode(child)) || cell), ...Array(Math.max(0, Number(cell.attrs?.colspan) || 1) - 1).fill("")]));
    const width = logical.reduce((max, row) => Math.max(max, row.length), 0);
    if (!width) return [""];
    const padded = logical.map((row) => [...row, ...Array(width - row.length).fill("")]);
    const first = padded[0] || Array(width).fill("");
    return [[`| ${first.join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n")];
  }
  return [markdownInlineText(node)];
};

/** Alignment and indent are unsupported in Markdown; block content survives semantically. */
export const serializeCanonicalListMarkdown = (document: SmartDocument): string => document.children.flatMap((node) =>
  isTextNode(node) ? [node.text] : markdownBlock(node)).join("\n");

type MdNode = { type: string; value?: string; url?: string; lang?: string; depth?: number; ordered?: boolean; start?: number; checked?: boolean | null; children?: MdNode[] };
const markdownText = (node: MdNode): string => node.value || (node.children || []).map(markdownText).join("");
const markdownInline = (node: MdNode, inherited: readonly SmartMark[] = []): SmartNode[] => {
  if (node.type === "text") return node.value ? [{ type: "text", text: node.value, ...(inherited.length ? { marks: canonicalMarkOrder(inherited) } : {}) }] : [];
  if (node.type === "inlineCode") return node.value ? [{ type: "text", text: node.value, marks: canonicalMarkOrder([...inherited, { type: "code" }]) }] : [];
  if (node.type === "break") return [{ type: "hard_break", id: createNodeId() }];
  const marks = [...inherited];
  if (node.type === "strong") marks.push({ type: "bold" });
  if (node.type === "emphasis") marks.push({ type: "italic" });
  if (node.type === "delete") marks.push({ type: "strike" });
  if (node.type === "link") marks.push({ type: "link", attrs: { href: node.url || "" } });
  return (node.children || []).flatMap((child) => markdownInline(child, marks));
};
const listFromMarkdown = (node: MdNode): SmartElementNode => {
  const checkable = (node.children || []).some((item) => item.checked !== null && item.checked !== undefined);
  return {
    type: "list", id: createNodeId(), attrs: {
      style: node.ordered ? "decimal" : "disc",
      ...(node.ordered && node.start && node.start !== 1 ? { start: node.start } : {}),
      ...(checkable ? { checkable: true } : {}),
    }, children: (node.children || []).map((itemNode) => {
      const blocks: SmartElementNode[] = [];
      (itemNode.children || []).forEach((child) => {
        blocks.push(...blocksFromMarkdown(child));
      });
      return { type: "list_item", id: createNodeId(), ...(checkable ? { attrs: { checked: itemNode.checked === true } } : {}), children: blocks.length ? blocks : [{ type: "paragraph", id: createNodeId(), children: [] }] };
    }),
  };
};

const blocksFromMarkdown = (node: MdNode): SmartElementNode[] => {
  if (node.type === "list") return [listFromMarkdown(node)];
  if (node.type === "heading") return [{ type: "heading", id: createNodeId(), attrs: { level: Math.max(1, Math.min(6, node.depth || 1)) }, children: (node.children || []).flatMap((inline) => markdownInline(inline)) }];
  if (node.type === "code") return [{ type: "code_block", id: createNodeId(), ...(node.lang ? { attrs: { language: node.lang } } : {}), children: node.value ? [{ type: "text", text: node.value }] : [] }];
  if (node.type === "blockquote") {
    const children = (node.children || []).flatMap(blocksFromMarkdown);
    return [{ type: "blockquote", id: createNodeId(), children: children.length ? children : [{ type: "paragraph", id: createNodeId(), children: [] }] }];
  }
  return [{ type: "paragraph", id: createNodeId(), children: (node.children || []).flatMap((inline) => markdownInline(inline)) }];
};

export const parseCanonicalListMarkdown = (markdown: string): SmartDocument => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MdNode;
  const children = (tree.children || []).flatMap(blocksFromMarkdown);
  return { type: "doc", id: createNodeId(), children: children.length ? children : [{ type: "paragraph", id: createNodeId(), children: [] }] };
};

export interface CanonicalDocxNumberingEntry {
  readonly itemId: string;
  readonly numId: number;
  readonly ilvl: number;
  readonly marker: "bullet" | "decimal";
  readonly text: string;
  readonly checked?: boolean;
}

/** DOCX has numId/ilvl but no Smart preset identity; presets fall back semantically. */
export const canonicalListToDocxNumbering = (document: SmartDocument): CanonicalDocxNumberingEntry[] => {
  const entries: CanonicalDocxNumberingEntry[] = [];
  let numId = 1;
  const visit = (list: SmartElementNode, depth: number, currentNumId: number) => {
    for (const child of list.children || []) {
      if (isTextNode(child)) continue;
      const content = (child.children || []).find((node) => !isTextNode(node) && node.type !== "list") as SmartElementNode | undefined;
      entries.push({
        itemId: child.id, numId: currentNumId, ilvl: depth,
        marker: orderedList(list) ? "decimal" : "bullet",
        text: content ? plainText(content) : "",
        ...(list.attrs?.checkable === true ? { checked: child.attrs?.checked === true } : {}),
      });
      (child.children || []).forEach((node) => { if (!isTextNode(node) && node.type === "list") visit(node, depth + 1, currentNumId); });
    }
  };
  document.children.forEach((node) => { if (!isTextNode(node) && node.type === "list") visit(node, 0, numId++); });
  return entries;
};

export const canonicalListPdfText = (document: SmartDocument): string => canonicalListToDocxNumbering(document)
  .map((entry) => `${"  ".repeat(entry.ilvl)}${entry.marker === "decimal" ? "1." : "•"} ${entry.text}`).join("\n");
