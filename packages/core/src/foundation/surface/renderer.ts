import katex from "katex";
import { isTextNode } from "../identity.js";
import {
  FoundationModelDomMapping,
  SMART_EMPTY_LINE_ATTRIBUTE,
  SMART_NODE_ID_ATTRIBUTE,
  SMART_PROJECTION_ATTRIBUTE,
  SMART_UI_ATTRIBUTE,
} from "../modelDom.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartSelection } from "../types.js";
import type { CanonicalSubtreeRenderer } from "./types.js";
import { renderMarkedText, stableValue } from "../marks/index.js";
import { occupancyGridFor, snapTableCellRect } from "../table/index.js";
import { sanitizeAtomSource } from "../atom/security.js";

/**
 * Security-hardened per the retired legacy KaTeX config this replaces:
 * trust:false blocks commands like \includegraphics/\href with adverse
 * side effects; strict:"error" rejects non-standard LaTeX outright rather
 * than silently tolerating it. Neither is relaxed here. `output` is left
 * at KaTeX's own default (`htmlAndMathml`) deliberately - that default
 * already emits MathML alongside the visual HTML, which is what makes
 * this accessible to screen readers beyond the aria-label below.
 */
const KATEX_OPTIONS = { trust: false, strict: "error" as const };

/** Genuinely invalid/incomplete LaTeX (a real possibility mid-typing) must not crash the whole document render. */
const renderFormulaInto = (element: HTMLElement, source: string): void => {
  try {
    katex.render(source, element, KATEX_OPTIONS);
  } catch {
    element.textContent = source;
  }
};

const atomTypes = new Set(["image", "block_image", "formula", "block_formula", "video", "audio"]);
const emptyLineOwnerTypes = new Set(["paragraph", "heading", "code_block"]);

const tagForNode = (node: SmartElementNode): string => {
  if (node.type === "paragraph") return "p";
  if (node.type === "heading") return `h${String(node.attrs?.level || 1)}`;
  if (node.type === "blockquote") return "blockquote";
  if (node.type === "code_block") return "pre";
  if (node.type === "list") {
    const marker = String(node.attrs?.style || node.attrs?.preset || "");
    return /^(?:decimal|lower-|upper-|ordered)/.test(marker) || node.attrs?.start !== undefined ? "ol" : "ul";
  }
  if (node.type === "list_item") return "li";
  if (node.type === "hard_break") return "br";
  if (node.type === "table") return "table";
  if (node.type === "table_row") return "tr";
  if (node.type === "table_cell") return node.attrs?.header === true ? "th" : "td";
  if (node.type === "image" || node.type === "block_image") return "img";
  if (node.type === "formula") return "span";
  if (node.type === "block_formula") return "div";
  if (node.type === "video" || node.type === "audio") return node.type;
  return "div";
};

export class FoundationSubtreeRenderer implements CanonicalSubtreeRenderer {
  readonly mapping = new FoundationModelDomMapping();
  private current: SmartDocument | null = null;
  private readonly modelById = new Map<string, SmartElementNode>();
  private compositionOwner: string | null = null;
  private writes = 0;
  private compositionWrites = 0;
  private liveRegion: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {
    root.contentEditable = "true";
    root.tabIndex = -1;
    root.setAttribute("data-smart-canonical-surface", "true");
  }

  get composingNodeId(): string | null { return this.compositionOwner; }
  get domWriteCount(): number { return this.writes; }
  get composingDomWriteCount(): number { return this.compositionWrites; }

  private recordWrite(ownerId?: string): void {
    this.writes += 1;
    if (this.compositionOwner && ownerId === this.compositionOwner) this.compositionWrites += 1;
  }

  private setAttribute(element: HTMLElement, name: string, value: string, ownerId: string): void {
    if (element.getAttribute(name) === value) return;
    element.setAttribute(name, value);
    this.recordWrite(ownerId);
  }

  private removeAttribute(element: HTMLElement, name: string, ownerId: string): void {
    if (!element.hasAttribute(name)) return;
    element.removeAttribute(name);
    this.recordWrite(ownerId);
  }

  private syncNodeAttributes(element: HTMLElement, node: SmartElementNode, listDepth = 0): void {
    if (node.attrs?.align) element.style.textAlign = String(node.attrs.align);
    else if (element.style.textAlign) element.style.removeProperty("text-align");
    if (node.attrs?.indentLevel) element.style.marginInlineStart = `${Number(node.attrs.indentLevel) * 2}em`;
    else if (element.style.marginInlineStart) element.style.removeProperty("margin-inline-start");
    if (node.type === "code_block") {
      const language = typeof node.attrs?.language === "string" && node.attrs.language.trim()
        ? node.attrs.language.trim()
        : null;
      if (language) this.setAttribute(element, "data-smart-language", language, node.id);
      else this.removeAttribute(element, "data-smart-language", node.id);
      this.setAttribute(element, "aria-label", language ? `Code block, ${language}` : "Code block", node.id);
    } else {
      this.removeAttribute(element, "data-smart-language", node.id);
    }
    if (node.type === "list") {
      const preset = typeof node.attrs?.preset === "string" ? node.attrs.preset : null;
      const style = typeof node.attrs?.style === "string" ? node.attrs.style : null;
      if (preset) {
        this.setAttribute(element, "data-smart-list-preset", preset, node.id);
        this.setAttribute(element, "data-srte-list-preset", preset, node.id);
      } else {
        this.removeAttribute(element, "data-smart-list-preset", node.id);
        this.removeAttribute(element, "data-srte-list-preset", node.id);
      }
      if (style) {
        this.setAttribute(element, "data-smart-list-style", style, node.id);
        this.setAttribute(element, "data-srte-list-style", style, node.id);
      } else {
        this.removeAttribute(element, "data-smart-list-style", node.id);
        this.removeAttribute(element, "data-srte-list-style", node.id);
      }
      // The preset marker rules are depth-specific.  The format serializer
      // already emits this value; the live renderer must project it too or
      // every non-default preset falls back to the browser's plain disc/
      // decimal marker.
      this.setAttribute(element, "data-smart-list-depth", String(listDepth), node.id);
      this.setAttribute(element, "data-srte-list-depth", String(listDepth), node.id);
      if (style && element.style.listStyleType !== style) {
        element.style.listStyleType = style;
        this.recordWrite(node.id);
      } else if (!style && element.style.listStyleType) {
        element.style.removeProperty("list-style-type");
        this.recordWrite(node.id);
      }
      if (node.attrs?.start !== undefined) this.setAttribute(element, "start", String(node.attrs.start), node.id);
      else this.removeAttribute(element, "start", node.id);
      this.setAttribute(element, "data-smart-checkable", node.attrs?.checkable === true ? "true" : "false", node.id);
      if (node.attrs?.checkable === true) this.setAttribute(element, "data-srte-checklist", "true", node.id);
      else this.removeAttribute(element, "data-srte-checklist", node.id);
    } else if (node.type === "list_item") {
      const parent = element.parentElement;
      const checkable = parent?.getAttribute("data-smart-checkable") === "true";
      let control = element.querySelector<HTMLElement>(`:scope > [${SMART_UI_ATTRIBUTE}="check-control"]`);
      if (checkable) {
        if (!control) {
          control = element.ownerDocument.createElement("button");
          control.setAttribute("type", "button");
          control.setAttribute(SMART_UI_ATTRIBUTE, "check-control");
          control.setAttribute("data-srte-check", "true");
          control.setAttribute("role", "checkbox");
          control.setAttribute("aria-label", "Toggle checklist item");
          control.contentEditable = "false";
          element.prepend(control);
          this.recordWrite(node.id);
        }
        const checked = node.attrs?.checked === true;
        this.setAttribute(control, "aria-checked", checked ? "true" : "false", node.id);
        this.setAttribute(control, "data-checked", checked ? "true" : "false", node.id);
        this.setAttribute(control, "aria-label", checked ? "Mark incomplete" : "Mark complete", node.id);
        this.setAttribute(element, "data-srte-checked", node.attrs?.checked === true ? "true" : "false", node.id);
        this.removeAttribute(element, "role", node.id);
        this.removeAttribute(element, "aria-checked", node.id);
        this.removeAttribute(element, "tabindex", node.id);
      } else {
        if (control) { control.remove(); this.recordWrite(node.id); }
        this.removeAttribute(element, "data-srte-checked", node.id);
        this.removeAttribute(element, "role", node.id);
        this.removeAttribute(element, "aria-checked", node.id);
        this.removeAttribute(element, "tabindex", node.id);
      }
    } else if (node.type === "table") {
      if (node.attrs?.layout) {
        const layout = String(node.attrs.layout);
        this.setAttribute(element, "data-smart-layout", layout, node.id);
        if (element.style.tableLayout !== layout) { element.style.tableLayout = layout; this.recordWrite(node.id); }
      }
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      let captionElement = element.querySelector<HTMLElement>(`:scope > [${SMART_PROJECTION_ATTRIBUTE}="table-caption"]`);
      if (caption) {
        if (!captionElement) {
          captionElement = element.ownerDocument.createElement("caption");
          captionElement.setAttribute(SMART_PROJECTION_ATTRIBUTE, "table-caption");
          captionElement.contentEditable = "false";
          element.prepend(captionElement);
          this.recordWrite(node.id);
        }
        if (captionElement.textContent !== caption) { captionElement.textContent = caption; this.recordWrite(node.id); }
      } else if (captionElement) { captionElement.remove(); this.recordWrite(node.id); }
    } else if (node.type === "table_row") {
      const height = Number(node.attrs?.height);
      if (Number.isFinite(height) && height > 0) element.style.height = `${height}px`;
      else element.style.removeProperty("height");
    } else if (node.type === "table_cell") {
      // Row height is canonical state on table_row.  A cell-level height can
      // survive a DOM subtree reuse (for example after a legacy resize or a
      // merge) and makes the browser count the same row height once per
      // covered cell.  Clear that stale presentation at the renderer
      // boundary; it is not part of the cell model and must never win over
      // the row's height.
      ["height", "min-height", "max-height"].forEach((property) => {
        if (element.style.getPropertyValue(property)) {
          element.style.removeProperty(property);
          this.recordWrite(node.id);
        }
      });
      this.removeAttribute(element, "height", node.id);
      const rowspan = Math.max(1, Number(node.attrs?.rowspan) || 1);
      const colspan = Math.max(1, Number(node.attrs?.colspan) || 1);
      if (rowspan > 1) this.setAttribute(element, "rowspan", String(rowspan), node.id); else this.removeAttribute(element, "rowspan", node.id);
      if (colspan > 1) this.setAttribute(element, "colspan", String(colspan), node.id); else this.removeAttribute(element, "colspan", node.id);
      if (node.attrs?.background) element.style.background = String(node.attrs.background); else element.style.removeProperty("background");
      if (node.attrs?.borders) element.style.border = String(node.attrs.borders); else element.style.removeProperty("border");
      if (node.attrs?.verticalAlign) element.style.verticalAlign = String(node.attrs.verticalAlign); else element.style.removeProperty("vertical-align");
    } else if (node.type === "image" || node.type === "block_image") {
      const source = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: "image", allowBlobPreview: node.attrs?.status === "pending" });
      if (source) this.setAttribute(element, "src", source, node.id); else this.removeAttribute(element, "src", node.id);
      this.setAttribute(element, "alt", typeof node.attrs?.alt === "string" ? node.attrs.alt : "", node.id);
      if (node.attrs?.decorative === true) this.setAttribute(element, "data-smart-decorative", "true", node.id);
      else this.removeAttribute(element, "data-smart-decorative", node.id);
      if (node.attrs?.width) this.setAttribute(element, "width", String(node.attrs.width), node.id); else this.removeAttribute(element, "width", node.id);
      if (node.attrs?.height) this.setAttribute(element, "height", String(node.attrs.height), node.id); else this.removeAttribute(element, "height", node.id);
      this.setAttribute(element, "data-smart-status", String(node.attrs?.status || "ready"), node.id);
      const imageAlign = node.attrs?.align;
      if (imageAlign === "center") { element.style.display = "block"; element.style.margin = "0 auto"; element.style.float = "none"; }
      else if (imageAlign === "left" || imageAlign === "right") { element.style.display = "inline"; element.style.float = imageAlign; element.style.margin = imageAlign === "left" ? "0 8px 8px 0" : "0 0 8px 8px"; }
    } else if (node.type === "formula" || node.type === "block_formula") {
      const source = String(node.attrs?.source || "");
      const previousSource = element.getAttribute("data-smart-formula");
      this.setAttribute(element, "role", "math", node.id);
      this.setAttribute(element, "aria-label", `Mathematical formula: ${source}`, node.id);
      this.setAttribute(element, "data-smart-formula", source, node.id);
      // KaTeX owns the element's children once rendered (real HTML+MathML,
      // not plain text); the dirty check moves to the source attribute
      // since textContent no longer equals the raw source after rendering.
      if (previousSource !== source || !element.hasChildNodes()) {
        renderFormulaInto(element, source);
        this.recordWrite(node.id);
      }
    } else if (node.type === "video" || node.type === "audio") {
      const source = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: node.type });
      if (source) this.setAttribute(element, "src", source, node.id); else this.removeAttribute(element, "src", node.id);
      this.setAttribute(element, "controls", "", node.id);
      this.setAttribute(element, "preload", "metadata", node.id);
      if (node.type === "video") this.setAttribute(element, "playsinline", "", node.id);
      else this.removeAttribute(element, "playsinline", node.id);
      if (node.attrs?.width) this.setAttribute(element, "width", String(node.attrs.width), node.id);
      else this.removeAttribute(element, "width", node.id);
      if (node.attrs?.height) this.setAttribute(element, "height", String(node.attrs.height), node.id);
      else this.removeAttribute(element, "height", node.id);
      const extension = source?.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
      const mediaType = node.type === "audio"
        ? extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav" : extension === "ogg" ? "audio/ogg" : extension === "webm" ? "audio/webm" : null
        : extension === "mp4" ? "video/mp4" : extension === "webm" ? "video/webm" : extension === "ogv" ? "video/ogg" : null;
      if (mediaType) this.setAttribute(element, "type", mediaType, node.id);
      else this.removeAttribute(element, "type", node.id);
      this.setAttribute(element, "aria-label", node.type === "video" ? "Video player" : "Audio player", node.id);
      if (node.type === "video" && node.attrs?.poster) {
        const poster = sanitizeAtomSource(String(node.attrs.poster), { kind: "image" });
        if (poster) this.setAttribute(element, "poster", poster, node.id); else this.removeAttribute(element, "poster", node.id);
      }
    }
  }

  /**
   * Keep failed remote resources visible as model-backed atoms instead of
   * leaving a silent broken-image/media control. The event only updates
   * renderer diagnostics; it never mutates the canonical document. A later
   * attribute transaction (retry, replacement, or upload completion) clears
   * the state through the normal diff path.
   */
  private installMediaDiagnostics(element: HTMLElement, node: SmartElementNode): void {
    if (!atomTypes.has(node.type) || node.type === "formula" || node.type === "block_formula") return;
    if (element.hasAttribute("data-smart-media-events")) return;
    element.setAttribute("data-smart-media-events", "true");
    const clear = () => {
      element.setAttribute("data-smart-media-state", "ready");
      element.removeAttribute("title");
    };
    const failed = () => {
      element.setAttribute("data-smart-media-state", "error");
      element.setAttribute("title", node.type === "block_image" || node.type === "image"
        ? "Image could not be loaded"
        : `${node.type === "video" ? "Video" : "Audio"} could not be loaded`);
    };
    element.addEventListener("load", clear);
    element.addEventListener("canplay", clear);
    element.addEventListener("error", failed);
  }

  private syncTableAccessibility(): void {
    this.root.querySelectorAll<HTMLElement>('[data-smart-type="table"]').forEach((tableElement) => {
      const mapped = this.mapping.domToNode(tableElement)?.node;
      if (!mapped || isTextNode(mapped) || mapped.type !== "table") return;
      const grid = occupancyGridFor(mapped);
      let headerRows = 0;
      while (headerRows < grid.rows && Array.from({ length: grid.columns }, (_, column) => grid.at(headerRows, column)?.node.attrs?.header === true).every(Boolean)) headerRows += 1;
      let headerColumns = 0;
      while (headerColumns < grid.columns && Array.from({ length: grid.rows }, (_, row) => grid.at(row, headerColumns)?.node.attrs?.header === true).every(Boolean)) headerColumns += 1;
      const headerIds = new Map<string, string>();
      grid.anchors.filter((cell) => cell.node.attrs?.header === true).forEach((cell) => headerIds.set(cell.cellId, `smart-header-${cell.cellId}`));
      grid.anchors.forEach((cell) => {
        const element = this.mapping.nodeToDom(cell.cellId);
        if (!(element instanceof HTMLElement)) return;
        const id = headerIds.get(cell.cellId);
        if (id) {
          element.id = id;
          element.setAttribute("scope", cell.left < headerColumns && cell.top >= headerRows ? "row" : "col");
          element.removeAttribute("headers");
        } else {
          element.removeAttribute("scope");
          const related = grid.anchors.filter((header) => header.node.attrs?.header === true && (
            header.top < headerRows && header.left <= cell.left && header.right > cell.left
            || header.left < headerColumns && header.top <= cell.top && header.bottom > cell.top
          ))
            .map((header) => headerIds.get(header.cellId)).filter((value): value is string => Boolean(value));
          if (related.length) element.setAttribute("headers", related.join(" ")); else element.removeAttribute("headers");
        }
      });
    });
  }

  private createNode(node: SmartNode, path: readonly number[], listDepth = 0): Node {
    if (isTextNode(node)) {
      this.recordWrite();
      return renderMarkedText(node, this.root.ownerDocument);
    }
    const element = this.root.ownerDocument.createElement(tagForNode(node));
    this.recordWrite(node.id);
    element.setAttribute(SMART_NODE_ID_ATTRIBUTE, node.id);
    element.setAttribute("data-smart-type", node.type);
    this.syncNodeAttributes(element, node, listDepth);
    this.installMediaDiagnostics(element, node);
    if (node.type === "hard_break") {
      element.setAttribute("data-smart-atomic", "true");
    } else if (node.type === "unknown" || node.attrs?.atomic === true || atomTypes.has(node.type)) {
      element.contentEditable = "false";
      element.setAttribute("data-smart-atomic", "true");
      if (node.type === "unknown") element.textContent = `[Unsupported: ${String(node.attrs?.originalType || "unknown")}]`;
    } else {
      const childListDepth = node.type === "list" ? listDepth + 1 : listDepth;
      node.children?.forEach((child, index) => element.appendChild(this.createNode(child, [...path, index], childListDepth)));
      if (node.type === "list") (node.children || []).forEach((child, index) => {
        if (!isTextNode(child)) {
          const childElement = this.modelChildren(element)[index];
          if (childElement instanceof HTMLElement) this.syncNodeAttributes(childElement, child);
        }
      });
      this.syncEmptyLineProjection(element, node);
    }
    this.modelById.set(node.id, node);
    this.mapping.track(node, path, element);
    return element;
  }

  private forget(node: SmartNode): void {
    if (isTextNode(node)) return;
    this.modelById.delete(node.id);
    this.mapping.forget(node.id);
    node.children?.forEach((child) => this.forget(child));
  }

  private modelChildren(element: HTMLElement): Node[] {
    return [...element.childNodes].filter((node) => {
      const candidate = node.nodeType === node.ELEMENT_NODE ? node as Element : node.parentElement;
      return !candidate?.closest(`[${SMART_UI_ATTRIBUTE}]`) && !candidate?.closest(`[${SMART_PROJECTION_ATTRIBUTE}]`);
    });
  }

  /**
   * Empty inline owners need a browser line box for an immediately visible
   * caret. This <br> is renderer UI, not canonical document content.
   */
  private syncEmptyLineProjection(element: HTMLElement, node: SmartElementNode): void {
    const existing = element.querySelector<HTMLElement>(`:scope > [${SMART_EMPTY_LINE_ATTRIBUTE}]`);
    const needsProjection = emptyLineOwnerTypes.has(node.type) && (node.children?.length || 0) === 0;
    if (needsProjection && !existing) {
      const line = element.ownerDocument.createElement("br");
      line.setAttribute(SMART_EMPTY_LINE_ATTRIBUTE, "true");
      line.setAttribute(SMART_UI_ATTRIBUTE, "empty-line");
      element.setAttribute("data-srte-caret-boundary", "true");
      element.appendChild(line);
      this.recordWrite(node.id);
    } else if (!needsProjection && existing) {
      existing.remove();
      element.removeAttribute("data-srte-caret-boundary");
      this.recordWrite(node.id);
    }
  }

  private diffElement(element: HTMLElement, before: SmartElementNode, after: SmartElementNode, path: readonly number[], listDepth = 0): boolean {
    this.modelById.set(after.id, after);
    this.mapping.track(after, path, element);
    if (after.id === this.compositionOwner) return false;
    this.setAttribute(element, SMART_NODE_ID_ATTRIBUTE, after.id, after.id);
    this.setAttribute(element, "data-smart-type", after.type, after.id);
    this.syncNodeAttributes(element, after, listDepth);
    this.installMediaDiagnostics(element, after);
    // Atomic nodes render their payload as presentation (for example, a
    // formula's accessible source text), not as model children.  Once a
    // stable-ID sibling is reused, recursing into that DOM subtree would
    // mistake the presentation text for an unmodelled child and remove it.
    // Keep the atom opaque after syncing its attributes; its model lifecycle
    // is handled by the parent diff and its dedicated attribute renderer.
    if (after.type === "unknown" || after.attrs?.atomic === true || atomTypes.has(after.type)) return false;
    const beforeChildren = before.children || [];
    const afterChildren = after.children || [];
    // Remove the visual-only empty line before inserting real model children.
    if (afterChildren.length) this.syncEmptyLineProjection(element, after);
    let structural = beforeChildren.length !== afterChildren.length
      || after.type === "table_cell" && ["rowspan", "colspan", "header"].some((attribute) => before.attrs?.[attribute] !== after.attrs?.[attribute]);

    for (let index = 0; index < afterChildren.length; index += 1) {
      const next = afterChildren[index];
      const previous = beforeChildren[index];
      if (next === previous) {
        if (!isTextNode(next) && atomTypes.has(next.type)) {
          const atomElement = this.modelChildren(element)[index];
          if (atomElement instanceof HTMLElement) this.syncNodeAttributes(atomElement, next);
        }
        continue;
      }
      const domChildren = this.modelChildren(element);
      let dom = domChildren[index] || null;
      let old = previous;
      // A sibling move can leave the DOM node already at this target index
      // even though `previous` describes the node that occupied the index in
      // the old model. Reconcile by stable node ID in that case. Treating the
      // old positional node as the identity here recreates the moved element,
      // drops its native caret, and can make the browser selection point at a
      // detached range while the model has already moved on.
      if (!isTextNode(next) && dom instanceof HTMLElement
        && dom.getAttribute(SMART_NODE_ID_ATTRIBUTE) === next.id) {
        // When the same ID remains at the same logical index, `previous` is
        // the immediately-rendered version and is fresher than the historical
        // ID cache. The cache is only needed for a node whose positional
        // predecessor has a different ID (the actual sibling-move case).
        old = Boolean(previous && !isTextNode(previous) && previous.id === next.id)
          ? previous
          : this.modelById.get(next.id) || next;
      }
      if (!isTextNode(next)) {
        const existing = this.mapping.nodeToDom(next.id);
        if (existing && existing.parentNode === element && existing !== dom) {
          element.insertBefore(existing, dom);
          this.recordWrite(after.id);
          dom = existing;
          old = this.modelById.get(next.id) || previous;
          structural = true;
        }
      }
      if (isTextNode(next)) {
        const sameMarks = !old || isTextNode(old) && stableValue(old.marks || []) === stableValue(next.marks || []);
        const textDom = dom?.nodeType === 3 ? dom : dom?.textContent !== undefined ? (() => {
          const walker = element.ownerDocument.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
          return walker.nextNode();
        })() : null;
        if (textDom?.nodeType === 3 && sameMarks) {
          if (textDom.nodeValue !== next.text) {
            textDom.nodeValue = next.text;
            this.recordWrite(after.id);
          }
        } else {
          const childListDepth = after.type === "list" ? listDepth + 1 : listDepth;
          const replacement = this.createNode(next, [...path, index], childListDepth);
          if (dom) element.replaceChild(replacement, dom);
          else element.appendChild(replacement);
          this.recordWrite(after.id);
          structural = true;
        }
      } else if (dom?.nodeType === 1 && old && !isTextNode(old) && old.id === next.id && (dom as Element).tagName.toLowerCase() === tagForNode(next)) {
        const childListDepth = after.type === "list" ? listDepth + 1 : listDepth;
        structural = this.diffElement(dom as HTMLElement, old, next, [...path, index], childListDepth) || structural;
      } else {
        const childListDepth = after.type === "list" ? listDepth + 1 : listDepth;
        const replacement = this.createNode(next, [...path, index], childListDepth);
        const previousSurvives = Boolean(previous && afterChildren.slice(index + 1).includes(previous));
        if (dom && previousSurvives) element.insertBefore(replacement, dom);
        else if (dom) element.replaceChild(replacement, dom);
        else element.appendChild(replacement);
        this.recordWrite(after.id);
        if (old && !previousSurvives) this.forget(old);
        structural = true;
      }
    }
    while (this.modelChildren(element).length > afterChildren.length) {
      const domChildren = this.modelChildren(element);
      const index = domChildren.length - 1;
      const removed = beforeChildren[index];
      element.removeChild(domChildren[index]);
      this.recordWrite(after.id);
      if (removed) this.forget(removed);
      structural = true;
    }
    this.syncEmptyLineProjection(element, after);
    return structural;
  }

  private selectionMatches(selection: Selection, anchor: { node: Node; offset: number }, head: { node: Node; offset: number }): boolean {
    return selection.anchorNode === anchor.node && selection.anchorOffset === anchor.offset
      && selection.focusNode === head.node && selection.focusOffset === head.offset;
  }

  private restoreSelection(model: SmartSelection): void {
    const selection = this.root.ownerDocument.getSelection();
    if (!selection) return;
    if (model.type === "none") {
      if (selection.rangeCount) selection.removeAllRanges();
      return;
    }
    const anchor = this.mapping.posToDom(model.anchor);
    const head = this.mapping.posToDom(model.head);
    if (!anchor || !head) return;
    if (!this.selectionMatches(selection, anchor, head)) {
      if (typeof selection.setBaseAndExtent === "function") {
        selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      } else {
        const range = this.root.ownerDocument.createRange();
        range.setStart(anchor.node, anchor.offset);
        range.setEnd(head.node, head.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    this.revealSelectionHead(head.node);
  }

  /** Cell selections are projected as a DOM-only highlight; cells remain model nodes. */
  private syncCellSelectionProjection(selection: SmartSelection): void {
    this.root.querySelectorAll<HTMLElement>("[data-smart-cell-selected]").forEach((cell) => cell.removeAttribute("data-smart-cell-selected"));
    if (selection.type !== "cell") return;
    const anchor = this.mapping.posToDom(selection.anchor)?.node;
    const head = this.mapping.posToDom(selection.head)?.node;
    const anchorCell = anchor instanceof Element ? anchor.closest<HTMLElement>('[data-smart-type="table_cell"]') : anchor?.parentElement?.closest<HTMLElement>('[data-smart-type="table_cell"]');
    const headCell = head instanceof Element ? head.closest<HTMLElement>('[data-smart-type="table_cell"]') : head?.parentElement?.closest<HTMLElement>('[data-smart-type="table_cell"]');
    if (!anchorCell || !headCell) return;
    const tableElement = anchorCell.closest<HTMLElement>('[data-smart-type="table"]');
    const mappedTable = tableElement ? this.mapping.domToNode(tableElement) : null;
    const mappedAnchor = this.mapping.domToNode(anchorCell);
    const mappedHead = this.mapping.domToNode(headCell);
    if (!mappedTable || !mappedAnchor || !mappedHead || isTextNode(mappedTable.node)
      || isTextNode(mappedAnchor.node) || isTextNode(mappedHead.node)) return;
    const grid = occupancyGridFor(mappedTable.node);
    const anchorGridCell = grid.anchors.find((cell) => cell.cellId === mappedAnchor.nodeId);
    const headGridCell = grid.anchors.find((cell) => cell.cellId === mappedHead.nodeId);
    if (!anchorGridCell || !headGridCell) return;
    // Cell selections are logical rectangles, not DOM-order ranges. DOM order
    // is row-major, so slicing it would select the cells between two vertical
    // endpoints (for example three cells in a 2x2 table) rather than the two
    // cells in the requested column. Snap through merged cells as the model
    // resolver does, then project exactly the resulting anchor IDs.
    const snapped = snapTableCellRect(mappedTable.node, {
      top: Math.min(anchorGridCell.top, headGridCell.top),
      left: Math.min(anchorGridCell.left, headGridCell.left),
      bottom: Math.max(anchorGridCell.bottom, headGridCell.bottom),
      right: Math.max(anchorGridCell.right, headGridCell.right),
    });
    const selected = new Set(snapped.cellIds);
    this.root.querySelectorAll<HTMLElement>('[data-smart-type="table_cell"]').forEach((cell) => {
      const mapped = this.mapping.domToNode(cell);
      if (mapped && selected.has(mapped.nodeId)) cell.setAttribute("data-smart-cell-selected", "true");
    });
  }

  /** Keep the active line visible without scrolling the surrounding page. */
  private revealSelectionHead(node: Node): void {
    const target = node.nodeType === node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    if (!target || target === this.root || !this.root.contains(target)) return;
    const rootRect = this.root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom > rootRect.bottom) {
      this.root.scrollTop += targetRect.bottom - rootRect.bottom + 8;
    } else if (targetRect.top < rootRect.top) {
      this.root.scrollTop -= rootRect.top - targetRect.top + 8;
    }
  }

  private listItemDepths(document: SmartDocument): Map<string, { depth: number; path: number[] }> {
    const output = new Map<string, { depth: number; path: number[] }>();
    const visit = (node: SmartNode, path: number[], depth: number) => {
      if (isTextNode(node)) return;
      if (node.type === "list_item") output.set(node.id, { depth: Math.max(0, depth - 1), path });
      const nextDepth = node.type === "list" ? depth + 1 : depth;
      node.children?.forEach((child, index) => visit(child, [...path, index], nextDepth));
    };
    visit(document, [], 0);
    return output;
  }

  /**
   * Checklist controls are renderer projections whose state depends on both
   * the list parent and the item attributes.  A list-type transition can keep
   * the item object reference unchanged, so the normal subtree identity skip
   * must not leave a stale checkbox projection behind.  Reconcile these
   * projections from the current model after every render; attribute writes
   * remain idempotent.
   */
  private syncListProjections(document: SmartDocument): void {
    const visit = (node: SmartNode, listDepth = 0): void => {
      if (isTextNode(node)) return;
      if (node.type === "list" || node.type === "list_item") {
        const element = this.mapping.nodeToDom(node.id);
        if (element) this.syncNodeAttributes(element, node, listDepth);
      }
      const childListDepth = node.type === "list" ? listDepth + 1 : listDepth;
      node.children?.forEach((child) => visit(child, childListDepth));
    };
    visit(document);
  }

  private announceSelectedLevel(before: SmartDocument, after: SmartDocument, selection: SmartSelection): void {
    const previous = this.listItemDepths(before);
    const next = this.listItemDepths(after);
    const active = [...next.entries()].filter(([, value]) => value.path.length <= selection.head.path.length
      && value.path.every((part, index) => selection.head.path[index] === part))
      .sort((left, right) => right[1].path.length - left[1].path.length)[0];
    if (!active || previous.get(active[0])?.depth === active[1].depth) return;
    if (!this.liveRegion) {
      const region = this.root.ownerDocument.createElement("div");
      region.setAttribute(SMART_UI_ATTRIBUTE, "list-level-announcement");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      region.contentEditable = "false";
      region.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
      this.root.appendChild(region);
      this.liveRegion = region;
    }
    this.liveRegion.textContent = `List level ${active[1].depth + 1}`;
  }

  render(document: SmartDocument, selection: SmartSelection): void {
    if (!this.current) {
      this.mapping.beginUpdate(document);
      document.children.forEach((node, index) => this.root.appendChild(this.createNode(node, [index])));
      this.current = document;
      this.mapping.rebuild(this.root, document);
      this.syncListProjections(document);
      this.syncTableAccessibility();
      this.modelById.set(document.id, document);
      this.restoreSelection(selection);
      this.syncCellSelectionProjection(selection);
      return;
    }
    if (this.current === document) {
      this.restoreSelection(selection);
      this.syncCellSelectionProjection(selection);
      return;
    }
    const before = this.current;
    this.mapping.beginUpdate(document);
    const structural = this.diffElement(this.root, before, document, []);
    this.modelById.set(document.id, document);
    this.current = document;
    if (structural) this.mapping.rebuild(this.root, document);
    this.syncListProjections(document);
    if (structural) this.syncTableAccessibility();
    this.restoreSelection(selection);
    this.syncCellSelectionProjection(selection);
    this.announceSelectedLevel(before, document, selection);
  }

  beginComposition(nodeId: string): void { this.compositionOwner = nodeId; }
  endComposition(): void { this.compositionOwner = null; }
  resetWriteCounters(): void { this.writes = 0; this.compositionWrites = 0; }

  destroy(): void {
    this.compositionOwner = null;
    this.current = null;
    this.modelById.clear();
    this.liveRegion?.remove();
    this.liveRegion = null;
  }
}

export const createSubtreeRenderer = (root: HTMLElement): CanonicalSubtreeRenderer => new FoundationSubtreeRenderer(root);
