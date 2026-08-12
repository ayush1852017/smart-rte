import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import { parseFragment, serialize } from "parse5";
import { parseCanonicalListHtml, serializeCanonicalListHtml } from "../../list/formats.js";
import type { SmartDocument } from "../../types.js";
import { importDocxDocumentWithMammoth } from "./import.js";
import { restorePortableDocxAtoms } from "./portableAtoms.js";

export interface StyledDocxImportResult {
  document: SmartDocument;
  layoutHtml: string;
  source: "wordprocessingml" | "mammoth";
}

const ELEMENT_NODE = 1;
const isElement = (node: XmlNode): node is XmlElement => node.nodeType === ELEMENT_NODE;
const directChildren = (node: XmlElement): XmlElement[] => Array.from(node.childNodes || []).filter(isElement);
const firstChildByName = (node: XmlElement | undefined | null, localName: string) =>
  node ? directChildren(node).find((child) => child.localName === localName) : undefined;
const childrenByName = (node: XmlElement | undefined | null, localName: string) =>
  node ? directChildren(node).filter((child) => child.localName === localName) : [];

const docxAttr = (node: XmlElement | undefined | null, name: string) => {
  if (!node) return "";
  return node.getAttribute(`w:${name}`)
    || node.getAttribute(name)
    || node.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name)
    || "";
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const docxHexColor = (value: string) => {
  if (!value || value.toLowerCase() === "auto") return "";
  const normalized = value.replace(/[^0-9a-f]/gi, "");
  return normalized.length === 6 ? `#${normalized}` : "";
};

const twipsToPt = (value: string) => {
  if (!value) return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.max(numeric / 20, 0)}pt` : "";
};

const halfPointsToPt = (value: string) => {
  if (!value) return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.max(numeric / 2, 1)}pt` : "";
};

const cssRules = (rules: Array<[string, string]>) =>
  rules.filter(([, value]) => Boolean(value)).map(([name, value]) => `${name}: ${value}`).join("; ");
const styleAttr = (style: string) => style ? ` style="${escapeHtml(style)}"` : "";

const borderCss = (border: XmlElement | undefined) => {
  if (!border) return "";
  const value = docxAttr(border, "val");
  if (!value || value === "nil" || value === "none") return "";
  const size = Number(docxAttr(border, "sz")) || 4;
  const color = docxHexColor(docxAttr(border, "color")) || "#d1d5db";
  return `${Math.max(size / 8, 0.5)}px solid ${color}`;
};

const paragraphStyle = (paragraph: XmlElement) => {
  const properties = firstChildByName(paragraph, "pPr");
  if (!properties) return "";
  const spacing = firstChildByName(properties, "spacing");
  const justification = firstChildByName(properties, "jc");
  const indent = firstChildByName(properties, "ind");
  const bottomBorder = firstChildByName(firstChildByName(properties, "pBdr"), "bottom");
  const line = docxAttr(spacing, "line");
  return cssRules([
    ["text-align", docxAttr(justification, "val")],
    ["margin-top", twipsToPt(docxAttr(spacing, "before"))],
    ["margin-bottom", twipsToPt(docxAttr(spacing, "after"))],
    ["margin-left", twipsToPt(docxAttr(indent, "left"))],
    ["text-indent", twipsToPt(docxAttr(indent, "firstLine"))],
    ["line-height", line && docxAttr(spacing, "lineRule") === "auto" ? `${Number(line) / 240}` : ""],
    ["border-bottom", borderCss(bottomBorder)],
  ]);
};

const runStyle = (run: XmlElement) => {
  const properties = firstChildByName(run, "rPr");
  if (!properties) return "";
  const color = docxHexColor(docxAttr(firstChildByName(properties, "color"), "val"));
  const highlight = docxHexColor(docxAttr(firstChildByName(properties, "highlight"), "val"));
  const shade = docxHexColor(docxAttr(firstChildByName(properties, "shd"), "fill"));
  return cssRules([
    ["font-weight", firstChildByName(properties, "b") ? "700" : ""],
    ["font-style", firstChildByName(properties, "i") ? "italic" : ""],
    ["text-decoration", firstChildByName(properties, "u") ? "underline" : ""],
    ["color", color],
    ["background-color", highlight || shade],
    ["font-size", halfPointsToPt(docxAttr(firstChildByName(properties, "sz"), "val"))],
  ]);
};

const runHtml = (run: XmlElement) => {
  const properties = firstChildByName(run, "rPr");
  const verticalAlignment = docxAttr(firstChildByName(properties, "vertAlign"), "val");
  const content = directChildren(run).map((child) => {
    if (child.localName === "t") return escapeHtml(child.textContent || "");
    if (child.localName === "tab") return "&emsp;";
    if (child.localName === "br") return docxAttr(child, "type") === "page" ? '<hr class="srte-docx-page-break">' : "<br>";
    return "";
  }).join("");
  if (!content) return "";
  const tag = verticalAlignment === "superscript" ? "sup" : verticalAlignment === "subscript" ? "sub" : "span";
  return `<${tag}${styleAttr(runStyle(run))}>${content}</${tag}>`;
};

const paragraphHtml = (paragraph: XmlElement) => {
  const content = childrenByName(paragraph, "r").map(runHtml).join("");
  return `<p${styleAttr(paragraphStyle(paragraph))}>${content || "<br>"}</p>`;
};

const cellStyle = (cell: XmlElement) => {
  const properties = firstChildByName(cell, "tcPr");
  const borders = firstChildByName(properties, "tcBorders");
  return cssRules([
    ["width", twipsToPt(docxAttr(firstChildByName(properties, "tcW"), "w"))],
    ["background-color", docxHexColor(docxAttr(firstChildByName(properties, "shd"), "fill"))],
    ["border-top", borderCss(firstChildByName(borders, "top"))],
    ["border-right", borderCss(firstChildByName(borders, "right"))],
    ["border-bottom", borderCss(firstChildByName(borders, "bottom"))],
    ["border-left", borderCss(firstChildByName(borders, "left"))],
    ["padding", "8px"],
    ["vertical-align", "top"],
  ]);
};

const tableHtml = (table: XmlElement): string => {
  const rows = childrenByName(table, "tr").map((row) => {
    const cells = childrenByName(row, "tc").map((cell) => {
      const content = directChildren(cell)
        .filter((child) => child.localName === "p" || child.localName === "tbl")
        .map((child) => child.localName === "p" ? paragraphHtml(child) : tableHtml(child))
        .join("");
      return `<td${styleAttr(cellStyle(cell))}>${content || "<p><br></p>"}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table style="border-collapse: collapse; width: 100%; margin: 12px 0;"><tbody>${rows}</tbody></table>`;
};

type HtmlAttribute = { name: string; value: string };
type HtmlNode = { nodeName: string; tagName?: string; attrs?: HtmlAttribute[]; childNodes?: HtmlNode[]; value?: string };
const styleDeclarations = (attrs: HtmlAttribute[]) => Object.fromEntries(
  (attrs.find((attr) => attr.name === "style")?.value || "").split(";")
    .map((rule) => rule.split(":").map((part) => part.trim()))
    .filter(([property]) => property));

/** Defensive baseline styling for any table missing explicit inline styles (e.g. the mammoth fallback path, which produces plain semantic HTML with no inline CSS at all). */
export const enhanceDocxTables = (html: string): string => {
  const visit = (node: HtmlNode): HtmlNode => {
    if (!node.childNodes) return node;
    const childNodes = node.childNodes.map((child) => {
      if (child.tagName !== "table" && child.tagName !== "td" && child.tagName !== "th") return visit(child);
      const attrs = [...(child.attrs || [])];
      const styleIndex = attrs.findIndex((attr) => attr.name === "style");
      const declarations = styleDeclarations(attrs);
      if (child.tagName === "table") {
        declarations["border-collapse"] ||= "collapse";
        declarations.width ||= "100%";
      } else {
        const hasBorder = ["border", "border-top", "border-right", "border-bottom", "border-left"].some((key) => declarations[key]);
        if (!hasBorder) declarations.border = "1px solid #d1d5db";
        declarations.padding ||= "8px";
        declarations["vertical-align"] ||= "top";
      }
      const style = Object.entries(declarations).map(([property, value]) => `${property}: ${value}`).join("; ");
      const next = { name: "style", value: style };
      if (styleIndex >= 0) attrs[styleIndex] = next; else attrs.push(next);
      return { ...visit(child), attrs };
    });
    return { ...node, childNodes };
  };
  const fragment = visit(parseFragment(html) as unknown as HtmlNode);
  return serialize(fragment as never);
};

const mammothFallback = async (arrayBuffer: ArrayBuffer): Promise<StyledDocxImportResult> => {
  const document = await importDocxDocumentWithMammoth(arrayBuffer);
  const layoutHtml = enhanceDocxTables(serializeCanonicalListHtml(document, { clean: true }));
  return { document, layoutHtml, source: "mammoth" };
};

/** Fidelity: `semantic` for structure, richer visual reproduction than plain mammoth import via inline CSS reconstructed from raw wordprocessingml formatting XML, with graceful fallback to mammoth if that XML is missing or malformed. */
export const importStyledDocxDocument = async (arrayBuffer: ArrayBuffer): Promise<StyledDocxImportResult> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) return mammothFallback(arrayBuffer);
    const parsed = new DOMParser().parseFromString(documentXml, "text/xml");
    if (!parsed || parsed.getElementsByTagName("parsererror").length) return mammothFallback(arrayBuffer);
    const body = Array.from(parsed.getElementsByTagName("*")).find((node) => node.localName === "body");
    if (!body) return mammothFallback(arrayBuffer);
    const rawHtml = directChildren(body as unknown as XmlElement).filter((node) => node.localName !== "sectPr").map((node) => {
      if (node.localName === "p") return paragraphHtml(node);
      if (node.localName === "tbl") return tableHtml(node);
      return "";
    }).join("");
    if (!rawHtml.trim()) return mammothFallback(arrayBuffer);
    const layoutHtml = enhanceDocxTables(restorePortableDocxAtoms(rawHtml));
    return { document: parseCanonicalListHtml(layoutHtml), layoutHtml, source: "wordprocessingml" };
  } catch {
    return mammothFallback(arrayBuffer);
  }
};
