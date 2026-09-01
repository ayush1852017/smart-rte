import katex from "katex";
// Registers \ce{...} chemistry-equation notation on the shared katex module
// instance, matching surface/renderer.ts's own live-render import - a
// formula baked here via renderFormulaHtml must support the exact same
// notation the live editor does, or a chemistry entry would render live but
// fall back to plain text in the exported/baked HTML.
import "katex/contrib/mhchem";
import { createNodeId } from "../identity.js";
import type { SmartElementNode } from "../types.js";
import { sanitizeLinkHref, sanitizeLinkTarget } from "../security/urlPolicy.js";
import { sanitizeAtomSource } from "./security.js";

const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (name: string, value: unknown) => value === undefined ? "" : ` ${name}="${escape(value)}"`;
const dimensions = (node: SmartElementNode) => `${attr("width", node.attrs?.width)}${attr("height", node.attrs?.height)}`;

// Mirrors surface/renderer.ts's KATEX_OPTIONS and try/catch-to-plain-text
// fallback exactly - a formula that fails to render live must fail the same
// way when baked into exported HTML, not throw and abort the whole export.
const KATEX_OPTIONS = { trust: false, strict: "error" as const };
const renderFormulaToHtml = (source: string): string => {
  try {
    return katex.renderToString(source, KATEX_OPTIONS);
  } catch {
    return escape(source);
  }
};

export const atomToHtml = (node: SmartElementNode, options?: { renderFormulaHtml?: boolean }): string => {
  if (node.type === "image" || node.type === "block_image") {
    const src = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: "image", allowBlobPreview: node.attrs?.status === "pending" }) || "";
    // Corner radius and license fields are data-attributes only (round-trip
    // fidelity), matching this same function's existing data-smart-align -
    // a raw HTML consumer displaying this string directly without also
    // running the live surface renderer's own style logic against it
    // wouldn't see visual rounding either way, same as align today; that's
    // a deliberate, pre-existing scope boundary this doesn't change.
    const img = `<img data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" src="${escape(src)}" alt="${escape(node.attrs?.alt)}"${dimensions(node)}${attr("data-smart-status", node.attrs?.status || "ready")}${node.attrs?.decorative === true ? ' data-smart-decorative="true"' : ""}${attr("data-smart-align", node.attrs?.align)}${attr("data-smart-radius", node.attrs?.borderRadius)}${attr("data-smart-license-description", node.attrs?.licenseDescription)}${attr("data-smart-license-source-url", node.attrs?.licenseSourceUrl)}${attr("data-smart-license-type", node.attrs?.licenseType)}${attr("data-smart-license-version", node.attrs?.licenseVersion)}${attr("data-smart-license-attribution", node.attrs?.licenseAttribution)}${attr("data-smart-href", node.attrs?.href)}${attr("data-smart-target", node.attrs?.target)}>`;
    // A real <a> wrapper, unlike the live surface renderer's plain data
    // attributes on the bare <img> - see surface/renderer.ts's own
    // reasoning (stable-element-per-id constraint that doesn't apply to
    // this string-based export) and modelDom.ts's identical choice for the
    // one-shot clipboard/print DOM builder.
    const linkHref = sanitizeLinkHref(typeof node.attrs?.href === "string" ? node.attrs.href : undefined);
    if (!linkHref) return img;
    const target = sanitizeLinkTarget(typeof node.attrs?.target === "string" ? node.attrs.target : undefined);
    return `<a href="${escape(linkHref)}"${target ? ` target="${escape(target)}"` : ""}>${img}</a>`;
  }
  if (node.type === "formula" || node.type === "block_formula") {
    const tag = node.type === "formula" ? "span" : "div";
    const source = String(node.attrs?.source || "");
    // The rendered KaTeX HTML is purely a self-contained visual convenience
    // for consumers that display this HTML string directly without also
    // running katex.render() against it themselves (docs/bugs/
    // formula-not-rendered-in-static-html-consumers.md) - data-smart-formula
    // stays the single source of truth for round-tripping back into the
    // model (list/formats.ts's parser reads the attribute, never this
    // inner content), so baking this in can never desync source vs. render.
    const inner = options?.renderFormulaHtml ? renderFormulaToHtml(source) : "";
    return `<${tag} data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" data-smart-notation="${escape(node.attrs?.notation || "latex")}" data-smart-formula="${escape(source)}" role="math" aria-label="${escape(`Mathematical formula: ${source}`)}">${inner}</${tag}>`;
  }
  if (node.type === "video" || node.type === "audio") {
    const src = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: node.type }) || "";
    return `<${node.type} data-smart-id="${escape(node.id)}" data-smart-type="${node.type}" src="${escape(src)}" controls${dimensions(node)}${node.type === "video" ? attr("poster", node.attrs?.poster) : ""}></${node.type}>`;
  }
  if (node.type === "divider") return `<hr data-smart-id="${escape(node.id)}" data-smart-type="divider">`;
  throw new Error(`Unsupported atom type "${node.type}".`);
};

export const atomFromHtmlElement = (rawElement: Element): SmartElementNode | null => {
  // atomToHtml's own inverse - a linked image now wraps in a real <a>
  // (needed so the link survives outside a live editor at all, see
  // atomToHtml's own doc comment); unwrap to the actual atom element
  // (which still carries every attribute, including data-smart-href,
  // directly) before parsing, matching what a single element's own
  // attributes already fully describe.
  const element = rawElement.tagName === "A" && rawElement.children.length === 1 ? rawElement.children[0] : rawElement;
  const declared = element.getAttribute("data-smart-type");
  const type = declared || (element.tagName === "IMG" ? "image" : element.tagName.toLowerCase());
  const id = element.getAttribute("data-smart-id") || createNodeId();
  const number = (name: string) => { const value = Number(element.getAttribute(name)); return Number.isFinite(value) && value > 0 ? value : undefined; };
  if (type === "image" || type === "block_image") {
    const src = sanitizeAtomSource(element.getAttribute("src"), { kind: "image" });
    if (!src) return null;
    const radius = Number(element.getAttribute("data-smart-radius"));
    return { type, id, attrs: {
      src, alt: element.getAttribute("alt") || "", status: element.getAttribute("data-smart-status") || "ready",
      ...(element.getAttribute("data-smart-decorative") === "true" ? { decorative: true } : {}),
      ...(element.getAttribute("data-smart-align") ? { align: element.getAttribute("data-smart-align")! } : {}),
      ...(number("width") ? { width: number("width") } : {}), ...(number("height") ? { height: number("height") } : {}),
      ...(Number.isFinite(radius) && radius > 0 ? { borderRadius: radius } : {}),
      ...(element.getAttribute("data-smart-href") ? { href: element.getAttribute("data-smart-href")! } : {}),
      ...(element.getAttribute("data-smart-target") ? { target: element.getAttribute("data-smart-target")! } : {}),
      ...(element.getAttribute("data-smart-license-description") ? { licenseDescription: element.getAttribute("data-smart-license-description")! } : {}),
      ...(element.getAttribute("data-smart-license-source-url") ? { licenseSourceUrl: element.getAttribute("data-smart-license-source-url")! } : {}),
      ...(element.getAttribute("data-smart-license-type") ? { licenseType: element.getAttribute("data-smart-license-type")! } : {}),
      ...(element.getAttribute("data-smart-license-version") ? { licenseVersion: element.getAttribute("data-smart-license-version")! } : {}),
      ...(element.getAttribute("data-smart-license-attribution") ? { licenseAttribution: element.getAttribute("data-smart-license-attribution")! } : {}),
    } };
  }
  if (type === "formula" || type === "block_formula") {
    return { type, id, attrs: { source: element.getAttribute("data-smart-formula") || "", notation: element.getAttribute("data-smart-notation") === "mathml" ? "mathml" : "latex" } };
  }
  if (type === "video" || type === "audio") {
    const src = sanitizeAtomSource(element.getAttribute("src"), { kind: type });
    if (!src) return null;
    return { type, id, attrs: { src, status: "ready", ...(type === "video" && element.getAttribute("poster") ? { poster: element.getAttribute("poster")! } : {}), ...(number("width") ? { width: number("width") } : {}), ...(number("height") ? { height: number("height") } : {}) } };
  }
  if (type === "divider" || element.tagName === "HR") return { type: "divider", id };
  return null;
};

export const atomToMarkdown = (node: SmartElementNode): string => {
  if (node.type === "image" || node.type === "block_image") return `![${String(node.attrs?.alt || "")}](${String(node.attrs?.src || "")})`;
  if (node.type === "formula" || node.type === "block_formula") return node.type === "formula" ? `$${String(node.attrs?.source || "")}$` : `$$\n${String(node.attrs?.source || "")}\n$$`;
  // Media is unsupported in Markdown. Preserve a readable link instead of dropping content.
  if (node.type === "video" || node.type === "audio") return `[${node.type}: ${String(node.attrs?.src || "")}](${String(node.attrs?.src || "")})`;
  if (node.type === "divider") return "---";
  return "";
};

export interface AtomDocxRun { readonly kind: "image" | "text"; readonly source: string; readonly alt?: string }
/**
 * Matches packages/core/src/foundation/formats/docx/export.ts's actual
 * behavior (SS2.1): formulas are written as literal LaTeX text inside an
 * <m:oMath> zone, not translated to real OMML and not rendered as an
 * image. Word will show the raw LaTeX string, not typeset math - this is
 * `kind: "text"`, not `"image"`, to describe that honestly.
 */
export const atomToDocx = (node: SmartElementNode): AtomDocxRun => node.type === "formula" || node.type === "block_formula"
  ? { kind: "text", source: String(node.attrs?.source || "") }
  : node.type === "image" || node.type === "block_image"
    ? { kind: "image", source: String(node.attrs?.src || ""), alt: String(node.attrs?.alt || "") }
    : node.type === "divider"
      ? { kind: "text", source: "---" }
      : { kind: "text", source: `[${node.type}: ${String(node.attrs?.src || "")}]` };

export const atomToPdf = (node: SmartElementNode): { kind: "image" | "text"; value: string } =>
  node.type === "formula" || node.type === "block_formula" ? { kind: "text", value: String(node.attrs?.source || "") }
    : node.type === "video" ? { kind: "image", value: String(node.attrs?.poster || node.attrs?.src || "") }
      : node.type === "image" || node.type === "block_image" ? { kind: "image", value: String(node.attrs?.src || "") }
        : node.type === "divider" ? { kind: "text", value: "---" }
          : { kind: "text", value: String(node.attrs?.src || "") };
