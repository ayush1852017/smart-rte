import { isTextNode } from "./identity.js";
import { nodeAtPath } from "./positions.js";
import type { ModelDomMapping, SmartDocument, SmartElementNode, SmartNode, SmartPos } from "./types.js";
import { renderMarkedText } from "./marks/dom.js";

export const SMART_UI_ATTRIBUTE = "data-smart-ui";
export const SMART_NODE_ID_ATTRIBUTE = "data-smart-id";

const tagForNode = (node: SmartNode): string => {
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
  return "div";
};

const renderNode = (node: SmartNode, ownerDocument: Document): Node => {
  if (isTextNode(node)) return renderMarkedText(node, ownerDocument);
  const element = ownerDocument.createElement(tagForNode(node));
  element.setAttribute(SMART_NODE_ID_ATTRIBUTE, node.id);
  element.setAttribute("data-smart-type", node.type);
  if (node.attrs?.align) element.style.textAlign = String(node.attrs.align);
  if (node.attrs?.indentLevel) element.style.marginInlineStart = `${Number(node.attrs.indentLevel) * 2}em`;
  if (node.type === "code_block") {
    const language = typeof node.attrs?.language === "string" && node.attrs.language.trim()
      ? node.attrs.language.trim()
      : null;
    if (language) element.setAttribute("data-smart-language", language);
    element.setAttribute("aria-label", language ? `Code block, ${language}` : "Code block");
  }
  if (node.type === "list") {
    if (typeof node.attrs?.preset === "string") element.setAttribute("data-smart-list-preset", node.attrs.preset);
    if (typeof node.attrs?.style === "string") {
      element.setAttribute("data-smart-list-style", node.attrs.style);
      element.style.listStyleType = node.attrs.style;
    }
    if (node.attrs?.start !== undefined) element.setAttribute("start", String(node.attrs.start));
    element.setAttribute("data-smart-checkable", node.attrs?.checkable === true ? "true" : "false");
  }
  if (node.type === "table_cell") {
    const rowspan = Math.max(1, Number(node.attrs?.rowspan) || 1);
    const colspan = Math.max(1, Number(node.attrs?.colspan) || 1);
    if (rowspan > 1) element.setAttribute("rowspan", String(rowspan));
    if (colspan > 1) element.setAttribute("colspan", String(colspan));
    if (node.attrs?.background) element.style.background = String(node.attrs.background);
    if (node.attrs?.borders) element.style.border = String(node.attrs.borders);
    if (node.attrs?.verticalAlign) element.style.verticalAlign = String(node.attrs.verticalAlign);
  }
  if (node.type === "hard_break") {
    element.setAttribute("data-smart-atomic", "true");
    return element;
  }
  if (node.type === "unknown") {
    element.contentEditable = "false";
    element.setAttribute("data-smart-atomic", "true");
    element.textContent = `[Unsupported: ${String(node.attrs?.originalType || "unknown")}]`;
    return element;
  }
  node.children?.forEach((child) => element.appendChild(renderNode(child, ownerDocument)));
  return element;
};

/**
 * Correctness renderer for the mapping contract. The production strategy is
 * contentEditable plus subtree diffing. Benchmark content-visibility before
 * considering windowing; destructive editable-region virtualization is out of
 * scope unless measurements prove it unavoidable.
 */
export const renderDocumentNaively = (root: HTMLElement, document: SmartDocument): FoundationModelDomMapping => {
  while (root.firstChild) root.removeChild(root.firstChild);
  document.children.forEach((node) => root.appendChild(renderNode(node, root.ownerDocument)));
  const mapping = new FoundationModelDomMapping();
  mapping.rebuild(root, document);
  return mapping;
};

export class FoundationModelDomMapping implements ModelDomMapping {
  private root: HTMLElement | null = null;
  private document: SmartDocument | null = null;
  private readonly byId = new Map<string, HTMLElement>();
  private readonly byDom = new WeakMap<Node, SmartNode>();
  private readonly pathById = new Map<string, number[]>();

  rebuild(root: HTMLElement, document: SmartDocument): void {
    this.root = root;
    this.document = document;
    this.byId.clear();
    this.pathById.clear();
    this.byId.set(document.id, root);
    this.byDom.set(root, document);
    this.pathById.set(document.id, []);
    const elements = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>(`[${SMART_NODE_ID_ATTRIBUTE}]`).forEach((element) => {
      const id = element.getAttribute(SMART_NODE_ID_ATTRIBUTE);
      if (id) elements.set(id, element);
    });
    const visit = (node: SmartNode, path: number[]) => {
      if (isTextNode(node)) return;
      const element = path.length ? elements.get(node.id) || null : root;
      if (element) {
        this.byId.set(node.id, element);
        this.byDom.set(element, node);
        this.pathById.set(node.id, path);
      }
      node.children?.forEach((child, index) => visit(child, [...path, index]));
    };
    visit(document, []);
  }

  /** Incremental renderer hook. Paths passed here are already current. */
  beginUpdate(document: SmartDocument): void {
    this.document = document;
    if (this.root) this.byDom.set(this.root, document);
  }

  track(node: SmartElementNode, path: readonly number[], element: HTMLElement): void {
    this.byId.set(node.id, element);
    this.byDom.set(element, node);
    this.pathById.set(node.id, [...path]);
  }

  forget(nodeId: string): void {
    this.byId.delete(nodeId);
    this.pathById.delete(nodeId);
  }

  nodeToDom(nodeId: string): HTMLElement | null { return this.byId.get(nodeId) || null; }

  domToNode(input: Node): { nodeId: string; node: SmartNode } | null {
    let node: Node | null = input;
    while (node && node !== this.root) {
      if (this.isEditorUiNode(node)) return null;
      const model = this.byDom.get(node);
      if (model && !isTextNode(model)) return { nodeId: model.id, node: model };
      node = node.parentNode;
    }
    const rootModel = this.root ? this.byDom.get(this.root) : undefined;
    return rootModel && !isTextNode(rootModel) ? { nodeId: rootModel.id, node: rootModel } : null;
  }

  private modelDomChildren(element: HTMLElement): Node[] {
    return [...element.childNodes].filter((child) => !this.isEditorUiNode(child));
  }

  private isInlineOwner(node: SmartElementNode): boolean {
    if (node.type === "paragraph" || node.type === "heading") return true;
    return Boolean(node.children?.length) && node.children!.every((child) =>
      isTextNode(child) || child.type === "hard_break" || child.attrs?.originalGroup === "inline");
  }

  private textDescendant(node: Node): Text | null {
    if (node.nodeType === node.TEXT_NODE) return node as Text;
    const walker = node.ownerDocument?.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    return walker?.nextNode() as Text | null;
  }

  posToDom(pos: SmartPos): { node: Node; offset: number } | null {
    if (!this.document) return null;
    const model = nodeAtPath(this.document, pos.path);
    if (!model || isTextNode(model)) return null;
    const element = this.byId.get(model.id);
    if (!element) return null;
    if (!this.isInlineOwner(model)) {
      const children = this.modelDomChildren(element);
      return pos.offset <= children.length ? { node: element, offset: pos.offset } : null;
    }
    let remaining = pos.offset;
    const domChildren = this.modelDomChildren(element);
    for (let index = 0; index < (model.children || []).length; index += 1) {
      const modelChild = model.children?.[index];
      const child = domChildren[index];
      if (!modelChild || !child) return null;
      if (isTextNode(modelChild)) {
        const length = modelChild.text.length;
        const text = this.textDescendant(child);
        if (remaining <= length && text) return { node: text, offset: remaining };
        remaining -= length;
      } else {
        const directIndex = ([...element.childNodes] as Node[]).indexOf(child);
        if (remaining === 0) return { node: element, offset: directIndex };
        if (remaining === 1) return { node: element, offset: directIndex + 1 };
        remaining -= 1;
      }
    }
    return remaining === 0 ? { node: element, offset: element.childNodes.length } : null;
  }

  domToPos(node: Node, offset: number): SmartPos | null {
    if (!this.root || !this.document || this.isEditorUiNode(node)) return null;
    const owner = this.domToNode(node);
    if (!owner) return null;
    if (isTextNode(owner.node)) return null;
    const ownerNode: SmartElementNode = owner.node;
    const path = this.pathById.get(owner.nodeId);
    const element = this.byId.get(owner.nodeId);
    if (!path || !element) return null;
    if (!this.isInlineOwner(ownerNode)) {
      if (node !== element) {
        const direct = node.nodeType === node.ELEMENT_NODE ? node as Element : node.parentElement;
        const child = direct?.closest(`[${SMART_NODE_ID_ATTRIBUTE}]`);
        const children = [...element.children].filter((candidate) => !this.isEditorUiNode(candidate));
        const index = child ? children.indexOf(child as HTMLElement) : -1;
        return index >= 0 ? { path: [...path], offset: index + (offset > 0 ? 1 : 0) } : null;
      }
      return { path: [...path], offset };
    }
    if (node === element) {
      const direct = this.modelDomChildren(element);
      const domChildren = [...element.childNodes] as Node[];
      const count = direct.filter((child) => domChildren.indexOf(child) < offset).length;
      const total = (ownerNode.children || []).slice(0, count)
        .reduce((sum, child) => sum + (isTextNode(child) ? child.text.length : 1), 0);
      return { path: [...path], offset: total };
    }
    let direct: Node | null = node;
    while (direct?.parentNode && direct.parentNode !== element) direct = direct.parentNode;
    if (!direct || direct.parentNode !== element) return null;
    const directIndex = this.modelDomChildren(element).indexOf(direct);
    const modelChild = ownerNode.children?.[directIndex];
    if (!modelChild) return null;
    const base = (ownerNode.children || []).slice(0, directIndex)
      .reduce((sum, child) => sum + (isTextNode(child) ? child.text.length : 1), 0);
    if (!isTextNode(modelChild)) return { path: [...path], offset: base + (offset > 0 ? 1 : 0) };
    try {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(direct);
      range.setEnd(node, offset);
      return { path: [...path], offset: base + Math.min(modelChild.text.length, range.toString().length) };
    } catch {
      return null;
    }
  }

  isEditorUiNode(node: Node): boolean {
    const element = node.nodeType === node.ELEMENT_NODE ? node as Element : node.parentElement;
    return Boolean(element?.closest(`[${SMART_UI_ATTRIBUTE}]`));
  }
}
