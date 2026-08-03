import type { Path, LegacySmartSelection } from "smartrte-core/legacy";

type Point = { path: Path; offset: number };

const LEAF_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const CONTAINER_TAGS = new Set(["blockquote", "ul", "ol", "li", "table", "tr", "td", "th"]);

export const isEditorOnlyElement = (node: Element) =>
  node.getAttribute("data-table-wrapper") === "true" ||
  node.hasAttribute("data-srte-selection-marker") ||
  node.hasAttribute("data-srte-resize-overlay") ||
  node.hasAttribute("data-srte-drag-handle") ||
  node.hasAttribute("data-srte-check") ||
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

/** Returns the semantic model path for a DOM element at the adapter boundary. */
export const pathForDomElement = (element: Element, editor: HTMLElement): Path | null =>
  pathForElement(element, editor);

type InlineDomUnit =
  | { type: "text"; node: Text }
  | { type: "atom"; node: Element };

const isInlineAtom = (element: Element) =>
  element.tagName.toLowerCase() === "img" || element.hasAttribute("data-formula");

const inlineUnitsIn = (root: Element): InlineDomUnit[] => {
  const units: InlineDomUnit[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) units.push({ type: "text", node: node as Text });
      return;
    }
    if (!(node instanceof Element) || isEditorOnlyElement(node)) return;
    if (isInlineAtom(node)) {
      units.push({ type: "atom", node });
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };
  Array.from(root.childNodes).forEach(visit);
  return units;
};

const pointRelativeTo = (
  container: Node,
  offset: number,
  unit: InlineDomUnit,
): "before" | "inside" | "after" | null => {
  const point = container.ownerDocument?.createRange();
  const unitRange = container.ownerDocument?.createRange();
  if (!point || !unitRange) return null;
  try {
    point.setStart(container, offset);
    point.collapse(true);
    if (unit.type === "text") unitRange.selectNodeContents(unit.node);
    else unitRange.selectNode(unit.node);
    const fromStart = point.compareBoundaryPoints(Range.START_TO_START, unitRange);
    const fromEnd = point.compareBoundaryPoints(Range.START_TO_END, unitRange);
    if (fromStart <= 0) return "before";
    if (fromEnd >= 0) return "after";
    return "inside";
  } catch {
    return null;
  }
};

const pointForDomPoint = (editor: HTMLElement, container: Node, offset: number): Point | null => {
  const leaf = closestLeaf(container, editor);
  if (!leaf) return null;
  const leafPath = pathForElement(leaf, editor);
  if (!leafPath) return null;
  const units = inlineUnitsIn(leaf);
  if (units.length === 0) return { path: [...leafPath, 0], offset: 0 };
  const directTextIndex = units.findIndex((unit) => unit.type === "text" && unit.node === container);
  if (directTextIndex >= 0) {
    const text = units[directTextIndex] as Extract<InlineDomUnit, { type: "text" }>;
    return {
      path: [...leafPath, directTextIndex],
      offset: Math.max(0, Math.min(offset, text.node.data.length)),
    };
  }
  let previousText: { index: number; node: Text } | null = null;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const relative = pointRelativeTo(container, offset, unit);
    if (relative === "before") {
      if (unit.type === "text") return { path: [...leafPath, index], offset: 0 };
      const nextTextIndex = units.slice(index + 1).findIndex((candidate) => candidate.type === "text");
      if (nextTextIndex >= 0) return { path: [...leafPath, index + 1 + nextTextIndex], offset: 0 };
      break;
    }
    if (unit.type === "text") previousText = { index, node: unit.node };
  }
  if (previousText) {
    return { path: [...leafPath, previousText.index], offset: previousText.node.data.length };
  }
  return null;
};

const nodeSelectionFromRange = (editor: HTMLElement, range: Range): LegacySmartSelection | null => {
  const nodes = Array.from(editor.querySelectorAll<HTMLElement>(
    "img, [data-formula], [data-srte-node-selection='true']",
  ));
  const selected = nodes.find((node) => {
    if (range.collapsed) return node === range.startContainer || node.contains(range.startContainer);
    const nodeRange = editor.ownerDocument.createRange();
    nodeRange.selectNode(node);
    return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) === 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, nodeRange) === 0;
  });
  if (!selected) return null;
  const path = pathForElement(selected, editor);
  return path ? { type: "node", path } : null;
};

/** Converts browser selection into a core selection without exposing editor UI nodes. */
export const selectionFromDom = (editor: HTMLElement, selection: Selection | null): LegacySmartSelection | null => {
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
  const unit = inlineUnitsIn(leaf)[point.path[point.path.length - 1]];
  if (unit?.type !== "text" || point.offset < 0 || point.offset > unit.node.data.length) return null;
  return { node: unit.node, offset: point.offset };
};

/** Restores a text selection from core paths after the editor DOM is rebuilt. */
export const restoreSelectionToDom = (editor: HTMLElement, smartSelection: LegacySmartSelection): boolean => {
  if (smartSelection.type === "node") {
    const element = elementAtPath(editor, smartSelection.path);
    if (!element) return false;
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = editor.ownerDocument.defaultView?.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
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
