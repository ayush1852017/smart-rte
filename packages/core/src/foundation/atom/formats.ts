import { createNodeId } from "../identity.js";
import type { SmartElementNode } from "../types.js";
import { sanitizeAtomSource } from "./security.js";

const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (name: string, value: unknown) => value === undefined ? "" : ` ${name}="${escape(value)}"`;
const dimensions = (node: SmartElementNode) => `${attr("width", node.attrs?.width)}${attr("height", node.attrs?.height)}`;

export const atomToHtml = (node: SmartElementNode): string => {
  if (node.type === "image" || node.type === "block_image") {
    const src = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: "image", allowBlobPreview: node.attrs?.status === "pending" }) || "";
    return `<img data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" src="${escape(src)}" alt="${escape(node.attrs?.alt)}"${dimensions(node)}${attr("data-smart-status", node.attrs?.status || "ready")}${node.attrs?.decorative === true ? ' data-smart-decorative="true"' : ""}${attr("data-smart-align", node.attrs?.align)}>`;
  }
  if (node.type === "formula" || node.type === "block_formula") {
    const tag = node.type === "formula" ? "span" : "div";
    return `<${tag} data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" data-smart-notation="${escape(node.attrs?.notation || "latex")}" data-smart-formula="${escape(node.attrs?.source)}" role="math" aria-label="${escape(`Mathematical formula: ${String(node.attrs?.source || "")}`)}"></${tag}>`;
  }
  if (node.type === "video" || node.type === "audio") {
    const src = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: node.type }) || "";
    return `<${node.type} data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" src="${escape(src)}" controls${dimensions(node)}${node.type === "video" ? attr("poster", node.attrs?.poster) : ""}></${node.type}>`;
  }
  throw new Error(`Unsupported atom type "${node.type}".`);
};

export const atomFromHtmlElement = (element: Element): SmartElementNode | null => {
  const declared = element.getAttribute("data-smart-type");
  const type = declared || (element.tagName === "IMG" ? "image" : element.tagName.toLowerCase());
  const id = element.getAttribute("data-smart-id") || createNodeId();
  const number = (name: string) => { const value = Number(element.getAttribute(name)); return Number.isFinite(value) && value > 0 ? value : undefined; };
  if (type === "image" || type === "block_image") {
    const src = sanitizeAtomSource(element.getAttribute("src"), { kind: "image" });
    if (!src) return null;
    return { type, id, attrs: { src, alt: element.getAttribute("alt") || "", status: element.getAttribute("data-smart-status") || "ready", ...(element.getAttribute("data-smart-decorative") === "true" ? { decorative: true } : {}), ...(element.getAttribute("data-smart-align") ? { align: element.getAttribute("data-smart-align")! } : {}), ...(number("width") ? { width: number("width") } : {}), ...(number("height") ? { height: number("height") } : {}) } };
  }
  if (type === "formula" || type === "block_formula") {
    return { type, id, attrs: { source: element.getAttribute("data-smart-formula") || "", notation: element.getAttribute("data-smart-notation") === "mathml" ? "mathml" : "latex" } };
  }
  if (type === "video" || type === "audio") {
    const src = sanitizeAtomSource(element.getAttribute("src"), { kind: type });
    if (!src) return null;
    return { type, id, attrs: { src, status: "ready", ...(type === "video" && element.getAttribute("poster") ? { poster: element.getAttribute("poster")! } : {}), ...(number("width") ? { width: number("width") } : {}), ...(number("height") ? { height: number("height") } : {}) } };
  }
  return null;
};

export const atomToMarkdown = (node: SmartElementNode): string => {
  if (node.type === "image" || node.type === "block_image") return `![${String(node.attrs?.alt || "")}](${String(node.attrs?.src || "")})`;
  if (node.type === "formula" || node.type === "block_formula") return node.type === "formula" ? `$${String(node.attrs?.source || "")}$` : `$$\n${String(node.attrs?.source || "")}\n$$`;
  // Media is unsupported in Markdown. Preserve a readable link instead of dropping content.
  if (node.type === "video" || node.type === "audio") return `[${node.type}: ${String(node.attrs?.src || "")}](${String(node.attrs?.src || "")})`;
  return "";
};

export interface AtomDocxRun { readonly kind: "image" | "text"; readonly source: string; readonly alt?: string }
export const atomToDocx = (node: SmartElementNode): AtomDocxRun => node.type === "formula" || node.type === "block_formula"
  ? { kind: "image", source: String(node.attrs?.source || ""), alt: "Rendered formula" }
  : node.type === "image" || node.type === "block_image"
    ? { kind: "image", source: String(node.attrs?.src || ""), alt: String(node.attrs?.alt || "") }
    : { kind: "text", source: `[${node.type}: ${String(node.attrs?.src || "")}]` };

export const atomToPdf = (node: SmartElementNode): { kind: "image" | "text"; value: string } =>
  node.type === "formula" || node.type === "block_formula" ? { kind: "text", value: String(node.attrs?.source || "") }
    : node.type === "video" ? { kind: "image", value: String(node.attrs?.poster || node.attrs?.src || "") }
      : node.type === "image" || node.type === "block_image" ? { kind: "image", value: String(node.attrs?.src || "") }
        : { kind: "text", value: String(node.attrs?.src || "") };
