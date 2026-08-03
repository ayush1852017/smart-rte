import {
  createSmartEditor,
  formulaPlugin,
  getNodeAtPath,
  mediaPlugin,
  type Path,
  type SmartFormulaNode,
} from "smartrte-core/legacy";
import { isEditorOnlyElement, pathForDomElement, selectionFromDom } from "./domSelectionBridge.js";
import { smartDocumentFromEditorRoot } from "./domSmartDocument.js";

const atomType = (element: Element) => {
  if (element.tagName.toLowerCase() === "img") return "inlineImage" as const;
  if (element.hasAttribute("data-formula")) return "formula" as const;
  return null;
};

const inlineUnits = (root: Element): Node[] => {
  const units: Node[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) units.push(node);
      return;
    }
    if (!(node instanceof Element) || isEditorOnlyElement(node)) return;
    if (atomType(node)) {
      units.push(node);
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };
  Array.from(root.childNodes).forEach(visit);
  return units;
};

export const inlineAtomPathFromDom = (
  root: HTMLElement,
  atom: HTMLElement,
): Path | null => {
  const leaf = atom.closest("p,h1,h2,h3,h4,h5,h6");
  if (!leaf || !root.contains(leaf)) return null;
  const leafPath = pathForDomElement(leaf, root);
  const index = inlineUnits(leaf).indexOf(atom);
  return leafPath && index >= 0 ? [...leafPath, index] : null;
};

/**
 * Runs deletion through the owning feature plugin and removes only the
 * validated live atom. Caret placement remains a DOM-host responsibility.
 */
export const executeDomInlineAtomDelete = (
  root: HTMLElement,
  atom: HTMLElement,
): boolean => {
  const type = atomType(atom);
  const path = type && inlineAtomPathFromDom(root, atom);
  if (!type || !path) return false;
  const selection = selectionFromDom(
    root,
    root.ownerDocument.defaultView?.getSelection() || null,
  ) || { type: "node" as const, path };
  const { document } = smartDocumentFromEditorRoot(root);
  const editor = createSmartEditor({
    state: { document, selection },
    plugins: type === "formula" ? [formulaPlugin] : [mediaPlugin],
  });
  const command = type === "formula" ? "formula.delete" : "image.delete-inline";
  if (!editor.execute(command, { path })) return false;
  atom.remove();
  return true;
};

export interface DomFormulaInput {
  value: string;
  displayText?: string;
}

/** Validates formula insertion through core, then projects only the new atom. */
export const executeDomFormulaInsert = (
  root: HTMLElement,
  input: DomFormulaInput,
  domSelection: Selection | null = root.ownerDocument.defaultView?.getSelection() || null,
): HTMLElement | null => {
  if (!domSelection?.rangeCount || !domSelection.isCollapsed) return null;
  const modelSelection = selectionFromDom(root, domSelection);
  if (!modelSelection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const editor = createSmartEditor({
    state: { document, selection: modelSelection },
    plugins: [formulaPlugin],
  });
  if (!editor.execute("formula.insert", input)) return null;
  const selectionAfter = editor.state.selection;
  if (selectionAfter.type !== "text") return null;
  const formulaPath = [
    ...selectionAfter.anchor.path.slice(0, -1),
    selectionAfter.anchor.path[selectionAfter.anchor.path.length - 1] - 1,
  ];
  const atom = getNodeAtPath(editor.state.document, formulaPath) as SmartFormulaNode | undefined;
  if (atom?.type !== "formula") return null;

  const range = domSelection.getRangeAt(0);
  const span = root.ownerDocument.createElement("span");
  span.dataset.formula = atom.value;
  span.textContent = atom.displayText ?? atom.value;
  range.insertNode(span);
  range.setStartAfter(span);
  range.collapse(true);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return span;
};

export const adjacentInlineAtom = (
  range: Range,
  direction: "backward" | "forward",
): HTMLElement | null => {
  if (!range.collapsed || range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
  const container = range.startContainer as Element;
  const index = direction === "backward" ? range.startOffset - 1 : range.startOffset;
  const candidate = container.childNodes[index];
  return candidate instanceof HTMLElement && atomType(candidate) ? candidate : null;
};
