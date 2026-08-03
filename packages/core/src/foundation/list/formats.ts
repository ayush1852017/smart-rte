import { parseFragment, serializeOuter } from "parse5";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { createNodeId, isTextNode } from "../identity.js";
import { canonicalMarkAttrs, canonicalMarkOrder } from "../marks/canonical.js";
import type { SmartDocument, SmartElementNode, SmartMark, SmartNode } from "../types.js";

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

const presetStyles: Record<string, readonly string[]> = {
  "ordered-upper-alpha": ["upper-alpha", "lower-alpha", "lower-roman"],
  "ordered-upper-roman": ["upper-roman", "upper-alpha", "decimal"],
  "ordered-decimal": ["decimal", "lower-alpha", "lower-roman"],
  "bullet-disc": ["disc", "circle", "square"],
  "bullet-circle": ["circle", "square", "disc"],
  "bullet-square": ["square", "circle", "disc"],
};

const effectiveStyle = (node: SmartElementNode, depth: number): string | undefined => {
  if (typeof node.attrs?.style === "string") return node.attrs.style;
  if (typeof node.attrs?.preset !== "string") return undefined;
  const styles = presetStyles[node.attrs.preset];
  return styles?.[Math.min(depth, styles.length - 1)];
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

const serializeBlock = (node: SmartElementNode, includeIds: boolean, listDepth = 0): string => {
  if (node.type === "unknown") {
    const raw = node.attrs?.raw as { html?: unknown } | undefined;
    if (typeof raw?.html === "string") return raw.html;
  }
  const id = includeIds ? ` data-smart-id="${escapeHtml(node.id)}"` : "";
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
  if (tag === "img" || attr(node, "data-smart-atomic") === "true") return [{
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

const parsedBlockAttrs = (node: HtmlNode): Record<string, unknown> => {
  const attrs: Record<string, unknown> = {};
  const align = attr(node, "data-smart-align") || styleValue(node, "text-align");
  const indent = Number(attr(node, "data-smart-indent"));
  if (align && ["left", "center", "right", "justify"].includes(align)) attrs.align = align;
  if (Number.isInteger(indent) && indent > 0) attrs.indentLevel = indent;
  return attrs;
};

const rawText = (node: HtmlNode): string => node.nodeName === "#text" ? node.value || ""
  : node.tagName === "br" ? "\n"
    : (node.childNodes || []).filter((child) => !isEditorUiNode(child)).map(rawText).join("");

const parseBlock = (node: HtmlNode): SmartElementNode | null => {
  const tag = node.tagName || "";
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
  if (tag === "ul" || tag === "ol") {
    const listAttrs: Record<string, unknown> = {};
    const preset = attr(node, "data-smart-list-preset") || attr(node, "data-srte-list-preset");
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
    if (attr(node, "style")) attrs.htmlStyle = attr(node, "style");
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
