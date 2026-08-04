import { isTextNode } from "../identity.js";
import {
  FoundationModelDomMapping,
  SMART_NODE_ID_ATTRIBUTE,
  SMART_PROJECTION_ATTRIBUTE,
  SMART_UI_ATTRIBUTE,
} from "../modelDom.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartSelection } from "../types.js";
import type { CanonicalSubtreeRenderer } from "./types.js";
import { renderMarkedText, stableValue } from "../marks/index.js";
import { occupancyGridFor } from "../table/index.js";
import { sanitizeAtomSource } from "../atom/security.js";

const atomTypes = new Set(["image", "block_image", "formula", "block_formula", "video", "audio"]);

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

  private syncNodeAttributes(element: HTMLElement, node: SmartElementNode): void {
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
      if (preset) this.setAttribute(element, "data-smart-list-preset", preset, node.id);
      else this.removeAttribute(element, "data-smart-list-preset", node.id);
      if (style) this.setAttribute(element, "data-smart-list-style", style, node.id);
      else this.removeAttribute(element, "data-smart-list-style", node.id);
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
    } else if (node.type === "list_item") {
      const parent = element.parentElement;
      const checkable = parent?.getAttribute("data-smart-checkable") === "true";
      let control = element.querySelector<HTMLElement>(`:scope > [${SMART_UI_ATTRIBUTE}="check-control"]`);
      if (checkable) {
        if (!control) {
          control = element.ownerDocument.createElement("button");
          control.setAttribute("type", "button");
          control.setAttribute(SMART_UI_ATTRIBUTE, "check-control");
          control.setAttribute("role", "checkbox");
          control.setAttribute("aria-label", "Toggle checklist item");
          control.contentEditable = "false";
          element.prepend(control);
          this.recordWrite(node.id);
        }
        this.setAttribute(control, "aria-checked", node.attrs?.checked === true ? "true" : "false", node.id);
        this.removeAttribute(element, "role", node.id);
        this.removeAttribute(element, "aria-checked", node.id);
        this.removeAttribute(element, "tabindex", node.id);
      } else {
        if (control) { control.remove(); this.recordWrite(node.id); }
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
      if (node.attrs?.width) this.setAttribute(element, "width", String(node.attrs.width), node.id); else this.removeAttribute(element, "width", node.id);
      if (node.attrs?.height) this.setAttribute(element, "height", String(node.attrs.height), node.id); else this.removeAttribute(element, "height", node.id);
      this.setAttribute(element, "data-smart-status", String(node.attrs?.status || "ready"), node.id);
      const imageAlign = node.attrs?.align;
      if (imageAlign === "center") { element.style.display = "block"; element.style.margin = "0 auto"; element.style.float = "none"; }
      else if (imageAlign === "left" || imageAlign === "right") { element.style.display = "inline"; element.style.float = imageAlign; element.style.margin = imageAlign === "left" ? "0 8px 8px 0" : "0 0 8px 8px"; }
    } else if (node.type === "formula" || node.type === "block_formula") {
      const source = String(node.attrs?.source || "");
      this.setAttribute(element, "role", "math", node.id);
      this.setAttribute(element, "aria-label", `Mathematical formula: ${source}`, node.id);
      this.setAttribute(element, "data-smart-formula", source, node.id);
      if (element.textContent !== source) { element.textContent = source; this.recordWrite(node.id); }
    } else if (node.type === "video" || node.type === "audio") {
      const source = sanitizeAtomSource(String(node.attrs?.src || ""), { kind: node.type });
      if (source) this.setAttribute(element, "src", source, node.id); else this.removeAttribute(element, "src", node.id);
      this.setAttribute(element, "controls", "", node.id);
      this.setAttribute(element, "aria-label", node.type === "video" ? "Video player" : "Audio player", node.id);
      if (node.type === "video" && node.attrs?.poster) {
        const poster = sanitizeAtomSource(String(node.attrs.poster), { kind: "image" });
        if (poster) this.setAttribute(element, "poster", poster, node.id); else this.removeAttribute(element, "poster", node.id);
      }
    }
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

  private createNode(node: SmartNode, path: readonly number[]): Node {
    if (isTextNode(node)) {
      this.recordWrite();
      return renderMarkedText(node, this.root.ownerDocument);
    }
    const element = this.root.ownerDocument.createElement(tagForNode(node));
    this.recordWrite(node.id);
    element.setAttribute(SMART_NODE_ID_ATTRIBUTE, node.id);
    element.setAttribute("data-smart-type", node.type);
    this.syncNodeAttributes(element, node);
    if (node.type === "hard_break") {
      element.setAttribute("data-smart-atomic", "true");
    } else if (node.type === "unknown" || node.attrs?.atomic === true || atomTypes.has(node.type)) {
      element.contentEditable = "false";
      element.setAttribute("data-smart-atomic", "true");
      if (node.type === "unknown") element.textContent = `[Unsupported: ${String(node.attrs?.originalType || "unknown")}]`;
    } else {
      node.children?.forEach((child, index) => element.appendChild(this.createNode(child, [...path, index])));
      if (node.type === "list") (node.children || []).forEach((child, index) => {
        if (!isTextNode(child)) {
          const childElement = this.modelChildren(element)[index];
          if (childElement instanceof HTMLElement) this.syncNodeAttributes(childElement, child);
        }
      });
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

  private diffElement(element: HTMLElement, before: SmartElementNode, after: SmartElementNode, path: readonly number[]): boolean {
    this.modelById.set(after.id, after);
    this.mapping.track(after, path, element);
    if (after.id === this.compositionOwner) return false;
    this.setAttribute(element, SMART_NODE_ID_ATTRIBUTE, after.id, after.id);
    this.setAttribute(element, "data-smart-type", after.type, after.id);
    this.syncNodeAttributes(element, after);
    const beforeChildren = before.children || [];
    const afterChildren = after.children || [];
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
          const replacement = this.createNode(next, [...path, index]);
          if (dom) element.replaceChild(replacement, dom);
          else element.appendChild(replacement);
          this.recordWrite(after.id);
          structural = true;
        }
      } else if (dom?.nodeType === 1 && old && !isTextNode(old) && old.id === next.id && (dom as Element).tagName.toLowerCase() === tagForNode(next)) {
        structural = this.diffElement(dom as HTMLElement, old, next, [...path, index]) || structural;
      } else {
        const replacement = this.createNode(next, [...path, index]);
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
    if (!anchor || !head || this.selectionMatches(selection, anchor, head)) return;
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
      this.root.querySelectorAll<HTMLElement>('[data-smart-type="list_item"]').forEach((element) => {
        const model = this.mapping.domToNode(element)?.node;
        if (model && !isTextNode(model)) this.syncNodeAttributes(element, model);
      });
      this.syncTableAccessibility();
      this.modelById.set(document.id, document);
      this.restoreSelection(selection);
      return;
    }
    if (this.current === document) {
      this.restoreSelection(selection);
      return;
    }
    const before = this.current;
    this.mapping.beginUpdate(document);
    const structural = this.diffElement(this.root, before, document, []);
    this.modelById.set(document.id, document);
    this.current = document;
    if (structural) this.mapping.rebuild(this.root, document);
    this.root.querySelectorAll<HTMLElement>('[data-smart-type="list_item"]').forEach((element) => {
      const model = this.mapping.domToNode(element)?.node;
      if (model && !isTextNode(model)) this.syncNodeAttributes(element, model);
    });
    if (structural) this.syncTableAccessibility();
    this.restoreSelection(selection);
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
