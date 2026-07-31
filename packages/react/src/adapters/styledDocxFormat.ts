import JSZip from "jszip";
import { normalizeSmartDocument, type SmartDocument } from "smartrte-core";
import { restorePortableDocxAtoms } from "./portableDocxAtoms.js";
import { serializeSmartDocument, smartDocumentFromHtml } from "./domSmartDocument.js";
import { importDocxDocumentWithMammoth } from "./docxFormat.js";

export interface StyledDocxImportResult {
  document: SmartDocument;
  layoutHtml: string;
  source: "wordprocessingml" | "mammoth";
}

const directChildren = (node: Element) => Array.from(node.children);
const firstChildByName = (node: Element | undefined | null, localName: string) =>
  node ? directChildren(node).find((child) => child.localName === localName) : undefined;
const childrenByName = (node: Element | undefined | null, localName: string) =>
  node ? directChildren(node).filter((child) => child.localName === localName) : [];

const docxAttr = (node: Element | undefined | null, name: string) => {
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

const borderCss = (border: Element | undefined) => {
  if (!border) return "";
  const value = docxAttr(border, "val");
  if (!value || value === "nil" || value === "none") return "";
  const size = Number(docxAttr(border, "sz")) || 4;
  const color = docxHexColor(docxAttr(border, "color")) || "#d1d5db";
  return `${Math.max(size / 8, 0.5)}px solid ${color}`;
};

const paragraphStyle = (paragraph: Element) => {
  const properties = firstChildByName(paragraph, "pPr");
  if (!properties) return "";
  const spacing = firstChildByName(properties, "spacing");
  const justification = firstChildByName(properties, "jc");
  const indent = firstChildByName(properties, "ind");
  const bottomBorder = firstChildByName(firstChildByName(properties, "pBdr") as Element, "bottom");
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

const runStyle = (run: Element) => {
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

const runHtml = (run: Element) => {
  const properties = firstChildByName(run, "rPr");
  const verticalAlignment = docxAttr(firstChildByName(properties as Element, "vertAlign"), "val");
  const content = directChildren(run).map((child) => {
    if (child.localName === "t") return escapeHtml(child.textContent || "");
    if (child.localName === "tab") return "&emsp;";
    if (child.localName === "br") {
      return docxAttr(child, "type") === "page" ? '<hr class="srte-docx-page-break">' : "<br>";
    }
    return "";
  }).join("");
  if (!content) return "";
  const tag = verticalAlignment === "superscript" ? "sup" : verticalAlignment === "subscript" ? "sub" : "span";
  return `<${tag}${styleAttr(runStyle(run))}>${content}</${tag}>`;
};

const paragraphHtml = (paragraph: Element) => {
  const content = childrenByName(paragraph, "r").map(runHtml).join("");
  return `<p${styleAttr(paragraphStyle(paragraph))}>${content || "<br>"}</p>`;
};

const cellStyle = (cell: Element) => {
  const properties = firstChildByName(cell, "tcPr");
  const borders = firstChildByName(properties as Element, "tcBorders");
  return cssRules([
    ["width", twipsToPt(docxAttr(firstChildByName(properties as Element, "tcW"), "w"))],
    ["background-color", docxHexColor(docxAttr(firstChildByName(properties as Element, "shd"), "fill"))],
    ["border-top", borderCss(firstChildByName(borders as Element, "top"))],
    ["border-right", borderCss(firstChildByName(borders as Element, "right"))],
    ["border-bottom", borderCss(firstChildByName(borders as Element, "bottom"))],
    ["border-left", borderCss(firstChildByName(borders as Element, "left"))],
    ["padding", "8px"],
    ["vertical-align", "top"],
  ]);
};

const tableHtml = (table: Element): string => {
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

export const enhanceDocxTables = (root: HTMLElement) => {
  root.querySelectorAll("table").forEach((table) => {
    const styledTable = table as HTMLElement;
    styledTable.style.borderCollapse ||= "collapse";
    styledTable.style.width ||= "100%";
    table.querySelectorAll("td, th").forEach((cell) => {
      const styledCell = cell as HTMLElement;
      if (!styledCell.style.border && !styledCell.style.borderTop && !styledCell.style.borderRight
        && !styledCell.style.borderBottom && !styledCell.style.borderLeft) {
        styledCell.style.border = "1px solid #d1d5db";
      }
      styledCell.style.padding ||= "8px";
      styledCell.style.verticalAlign ||= "top";
    });
  });
};

const mammothFallback = async (
  arrayBuffer: ArrayBuffer,
  ownerDocument: Document,
): Promise<StyledDocxImportResult> => {
  const document = await importDocxDocumentWithMammoth(arrayBuffer, ownerDocument);
  const container = ownerDocument.createElement("div");
  container.innerHTML = serializeSmartDocument(document);
  enhanceDocxTables(container);
  return { document, layoutHtml: container.innerHTML, source: "mammoth" };
};

export const importStyledDocxDocument = async (
  arrayBuffer: ArrayBuffer,
  ownerDocument: Document,
): Promise<StyledDocxImportResult> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) return mammothFallback(arrayBuffer, ownerDocument);
    const parsed = new ownerDocument.defaultView!.DOMParser().parseFromString(documentXml, "application/xml");
    if (parsed.querySelector("parsererror")) return mammothFallback(arrayBuffer, ownerDocument);
    const body = Array.from(parsed.getElementsByTagName("*")).find((node) => node.localName === "body");
    if (!body) return mammothFallback(arrayBuffer, ownerDocument);
    const rawHtml = directChildren(body).filter((node) => node.localName !== "sectPr").map((node) => {
      if (node.localName === "p") return paragraphHtml(node);
      if (node.localName === "tbl") return tableHtml(node);
      return "";
    }).join("");
    if (!rawHtml.trim()) return mammothFallback(arrayBuffer, ownerDocument);
    const container = ownerDocument.createElement("div");
    container.innerHTML = restorePortableDocxAtoms(rawHtml, ownerDocument);
    enhanceDocxTables(container);
    return {
      document: normalizeSmartDocument(smartDocumentFromHtml(container.innerHTML, ownerDocument)),
      layoutHtml: container.innerHTML,
      source: "wordprocessingml",
    };
  } catch {
    return mammothFallback(arrayBuffer, ownerDocument);
  }
};
