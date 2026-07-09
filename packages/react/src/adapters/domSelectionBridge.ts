import type { Path, SmartSelection } from "smartrte-core";

type Point = { path: Path; offset: number };

const LEAF_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const CONTAINER_TAGS = new Set(["blockquote", "ul", "ol", "li", "table", "tr", "td", "th"]);

export const isEditorOnlyElement = (node: Element) =>
  node.getAttribute("data-table-wrapper") === "true" ||
  Array.from(node.attributes).some((attribute) => attribute.name.startsWith("data-srte-")) ||
  node.matches(".srte-table-resize-handle, .srte-table-resize-overlay, .srte-drag-handle");

const isSemanticElement = (node: Element) => LEAF_TAGS.has(node.tagName.toLowerCase()) || CONTAINER_TAGS.has(node.tagName.toLowerCase());

const hasSemanticChild = (node: Element) =>
  Array.from(node.children).some((child) => !isEditorOnlyElement(child) && isSemanticElement(child));

const isVirtualLeaf = (node: Element) => {
  const tag = node.tagName.toLowerCase();
  return (tag === "li" || tag === "td" || tag === "th") && !hasSemanticChild(node);
};

const isLeaf = (node: Element) => LEAF_TAGS.has(node.tagName.toLowerCase()) || isVirtualLeaf(node);

const closestElement = (node: Node | null): Element | null => {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
};

const closestLeaf = (node: Node | null, editor: HTMLElement): Element | null => {
  let element = closestElement(node);
  while (element && element !== editor) {
    if (isEditorOnlyElement(element)) return null;
    if (isLeaf(element)) return element;
    element = element.parentElement;
  }
  return null;
};

const semanticChildren = (parent: HTMLElement | Element): Element[] => {
  const result: Element[] = [];
  Array.from(parent.children).forEach((child) => {
    if (isEditorOnlyElement(child)) {
      result.push(...semanticChildren(child));
    } else if (isSemanticElement(child)) {
      result.push(child);
    } else {
      result.push(...semanticChildren(child));
    }
  });
  return result;
};

const pathForElement = (element: Element, editor: HTMLElement): Path | null => {
  const findPath = (parent: HTMLElement | Element, basePath: Path): Path | null => {
    const children = semanticChildren(parent);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const path = [...basePath, index];
      if (child === element) return path;
      if (child.contains(element)) {
        const nestedPath = findPath(child, path);
        if (nestedPath) return nestedPath;
      }
    }
    return null;
  };

  return findPath(editor, []);
};

const textNodesIn = (root: Element): Text[] => {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent && parent !== root) {
        if (isEditorOnlyElement(parent)) return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
};

const offsetBeforePoint = (leaf: Element, container: Node, offset: number): number | null => {
  if (!leaf.contains(container) && leaf !== container) return null;
  const range = leaf.ownerDocument.createRange();
  range.selectNodeContents(leaf);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
};

const pointForDomPoint = (editor: HTMLElement, container: Node, offset: number): Point | null => {
  const leaf = closestLeaf(container, editor);
  if (!leaf) return null;
  const leafPath = pathForElement(leaf, editor);
  if (!leafPath) return null;
  const textNodes = textNodesIn(leaf);
  if (textNodes.length === 0) return { path: [...leafPath, 0], offset: 0 };
  const absoluteOffset = offsetBeforePoint(leaf, container, offset);
  if (absoluteOffset == null) return null;

  let remaining = absoluteOffset;
  for (let index = 0; index < textNodes.length; index += 1) {
    const length = textNodes[index].data.length;
    if (remaining <= length) return { path: [...leafPath, index], offset: remaining };
    remaining -= length;
  }
  const last = textNodes.length - 1;
  return { path: [...leafPath, last], offset: textNodes[last].data.length };
};

const nodeSelectionFromRange = (editor: HTMLElement, range: Range): SmartSelection | null => {
  const nodes = Array.from(editor.querySelectorAll<HTMLElement>("img, [data-srte-node-selection='true']"));
  const selected = nodes.find((node) => range.intersectsNode(node));
  if (!selected) return null;
  const path = pathForElement(selected, editor);
  return path ? { type: "node", path } : null;
};

/** Converts browser selection into a core selection without exposing editor UI nodes. */
export const selectionFromDom = (editor: HTMLElement, selection: Selection | null): SmartSelection | null => {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;

  const nodeSelection = nodeSelectionFromRange(editor, range);
  if (nodeSelection) return nodeSelection;

  const anchor = pointForDomPoint(editor, range.startContainer, range.startOffset);
  const focus = pointForDomPoint(editor, range.endContainer, range.endOffset);
  if (!anchor || !focus) return null;
  return { type: "text", anchor, focus };
};

const elementAtPath = (editor: HTMLElement, path: Path): Element | null => {
  let current: HTMLElement | Element = editor;
  for (const index of path) {
    const next = semanticChildren(current)[index];
    if (!next) return null;
    current = next;
  }
  return current;
};

const domPointForSmartPoint = (editor: HTMLElement, point: Point): { node: Text; offset: number } | null => {
  if (point.path.length === 0) return null;
  const leaf = elementAtPath(editor, point.path.slice(0, -1));
  if (!leaf) return null;
  const text = textNodesIn(leaf)[point.path[point.path.length - 1]];
  if (!text || point.offset < 0 || point.offset > text.data.length) return null;
  return { node: text, offset: point.offset };
};

/** Restores a text selection from core paths after the editor DOM is rebuilt. */
export const restoreSelectionToDom = (editor: HTMLElement, smartSelection: SmartSelection): boolean => {
  if (smartSelection.type !== "text") return false;
  const anchor = domPointForSmartPoint(editor, smartSelection.anchor);
  const focus = domPointForSmartPoint(editor, smartSelection.focus);
  if (!anchor || !focus) return false;
  const range = editor.ownerDocument.createRange();
  try {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    const selection = editor.ownerDocument.defaultView?.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
};
