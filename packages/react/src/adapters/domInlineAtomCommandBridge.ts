import {
  applyOperations,
  atomDeclarations,
  createNodeId,
  createScopeIndex,
  deleteAtom,
  foundationSchema,
  insertAtom,
  parseCanonicalListHtml,
  renderDocumentNaively,
  updateAtom,
  type AtomicNodeScope,
  type Attrs,
  type SmartDocument,
  type SmartElementNode,
} from "smartrte-core/foundation";
import { isEditorOnlyElement, pathForDomElement } from "./domSelectionBridge.js";

const atomType = (element: Element) => {
  const declared = element.getAttribute("data-smart-type");
  if (declared === "image" || element.tagName.toLowerCase() === "img") return "image" as const;
  if (declared === "formula" || element.hasAttribute("data-formula") || element.hasAttribute("data-smart-formula")) return "formula" as const;
  return null;
};

const inlineUnits = (root: Element): Node[] => {
  const units: Node[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) units.push(node); return; }
    if (!(node instanceof Element) || isEditorOnlyElement(node)) return;
    if (atomType(node)) { units.push(node); return; }
    Array.from(node.childNodes).forEach(visit);
  };
  Array.from(root.childNodes).forEach(visit);
  return units;
};

export const inlineAtomPathFromDom = (root: HTMLElement, atom: HTMLElement): number[] | null => {
  const leaf = atom.closest("p,h1,h2,h3,h4,h5,h6");
  if (!leaf || !root.contains(leaf)) return null;
  const leafPath = pathForDomElement(leaf, root);
  const index = inlineUnits(leaf).indexOf(atom);
  return leafPath && index >= 0 ? [...leafPath, index] : null;
};

const ownerSelector = "p,h1,h2,h3,h4,h5,h6";
const prepareOwner = (owner: HTMLElement) => {
  owner.dataset.smartId ||= createNodeId();
  owner.querySelectorAll<HTMLElement>("img,[data-formula],[data-smart-formula]").forEach((atom) => {
    atom.dataset.smartId ||= createNodeId();
    if (atomType(atom) === "formula") {
      atom.dataset.smartType = "formula";
      atom.dataset.smartFormula = atom.dataset.smartFormula || atom.dataset.formula || atom.textContent || "";
      atom.dataset.smartNotation ||= "latex";
      atom.dataset.smartAtomic = "true";
    } else {
      atom.dataset.smartType = "image";
      atom.dataset.smartStatus ||= "ready";
      atom.dataset.smartAtomic = "true";
    }
  });
};

const parseOwner = (owner: HTMLElement): SmartDocument => {
  prepareOwner(owner);
  return parseCanonicalListHtml(owner.outerHTML);
};

const contentWidth = (node: Node): number => {
  if (node.nodeType === node.TEXT_NODE) return node.nodeValue?.length || 0;
  if (node instanceof HTMLElement && atomType(node)) return 1;
  if (node instanceof HTMLElement && isEditorOnlyElement(node)) return 0;
  return [...node.childNodes].reduce((sum, child) => sum + contentWidth(child), 0);
};

const caretOffset = (owner: HTMLElement, range: Range): number | null => {
  const before = owner.ownerDocument.createRange();
  before.selectNodeContents(owner);
  try { before.setEnd(range.startContainer, range.startOffset); } catch { return null; }
  return contentWidth(before.cloneContents());
};

const renderOwner = (owner: HTMLElement, document: SmartDocument) => {
  const projection = owner.ownerDocument.createElement("div");
  renderDocumentNaively(projection, document);
  const replacement = Array.from(projection.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .find((element) => element.dataset.smartId === owner.dataset.smartId);
  if (!replacement) return false;
  owner.replaceChildren(...Array.from(replacement.childNodes));
  return true;
};

export interface DomFormulaInput { value: string; displayText?: string }
export interface DomCanonicalAtomInput { type: "image" | "formula"; attrs: Attrs }

export const executeDomCanonicalAtomInsert = (
  root: HTMLElement,
  input: DomCanonicalAtomInput,
  domSelection: Selection | null = root.ownerDocument.defaultView?.getSelection() || null,
): HTMLElement | null => {
  if (!domSelection?.rangeCount || !domSelection.isCollapsed) return null;
  const range = domSelection.getRangeAt(0);
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const owner = element?.closest<HTMLElement>(ownerSelector);
  if (!owner || !root.contains(owner)) return null;
  const offset = caretOffset(owner, range);
  if (offset === null) return null;
  const document = parseOwner(owner);
  const declaration = atomDeclarations.find((entry) => entry.type === input.type)!;
  const nodeId = createNodeId();
  const index = createScopeIndex();
  const operations = insertAtom(document, { kind: "empty", range: { from: { path: [0], offset }, to: { path: [0], offset } }, isolatingAncestorId: null, clamped: false }, {
    declaration, nodeId, attrs: input.attrs, ownerId: owner.dataset.smartId!, offset,
  }, { schema: foundationSchema, positions: index.positions(document, foundationSchema) });
  if (!operations.length || !renderOwner(owner, applyOperations(document, operations))) return null;
  const atom = Array.from(owner.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .find((element) => element.dataset.smartId === nodeId) || null;
  if (!atom) return null;
  if (input.type === "formula") {
    atom.dataset.formula = String(input.attrs.source || "");
    atom.textContent = String(input.attrs.displayText || input.attrs.source || "");
  } else atom.dataset.srteInline = "true";
  const next = root.ownerDocument.createRange(); next.setStartAfter(atom); next.collapse(true);
  domSelection.removeAllRanges(); domSelection.addRange(next);
  return atom;
};

export const executeDomFormulaInsert = (root: HTMLElement, input: DomFormulaInput, selection?: Selection | null): HTMLElement | null =>
  executeDomCanonicalAtomInsert(root, { type: "formula", attrs: { source: input.value.trim(), notation: "latex", ...(input.displayText ? { displayText: input.displayText } : {}) } }, selection);

export const executeDomInlineAtomDelete = (root: HTMLElement, atom: HTMLElement): boolean => {
  const owner = atom.closest<HTMLElement>(ownerSelector);
  if (!owner || !root.contains(owner) || !atomType(atom)) return false;
  prepareOwner(owner);
  const id = atom.dataset.smartId!;
  const document = parseOwner(owner);
  const index = createScopeIndex();
  const positions = index.positions(document, foundationSchema);
  const range = positions.rangeOf(id);
  if (!range) return false;
  const scope: AtomicNodeScope = { kind: "atomic-node", nodeId: id, inline: true, range, isolatingAncestorId: null, clamped: false };
  const operations = deleteAtom(document, scope, {}, { schema: foundationSchema, positions });
  return operations.length > 0 && renderOwner(owner, applyOperations(document, operations));
};

export const executeDomCanonicalAtomUpdate = (root: HTMLElement, atom: HTMLElement, attrs: Attrs): boolean => {
  const owner = atom.closest<HTMLElement>(ownerSelector);
  if (!owner || !root.contains(owner) || !atomType(atom)) return false;
  prepareOwner(owner);
  const id = atom.dataset.smartId!;
  const document = parseOwner(owner);
  const index = createScopeIndex(); const positions = index.positions(document, foundationSchema); const range = positions.rangeOf(id);
  if (!range) return false;
  const scope: AtomicNodeScope = { kind: "atomic-node", nodeId: id, inline: true, range, isolatingAncestorId: null, clamped: false };
  const operations = updateAtom(document, scope, { attrs }, { schema: foundationSchema, positions });
  if (!operations.length) return false;
  const output = applyOperations(document, operations);
  const nextPositions = createScopeIndex().positions(output, foundationSchema);
  const resolved = nextPositions.positionOf(id);
  const next = resolved?.parent.children?.find((child): child is SmartElementNode => child.type !== "text" && "id" in child && child.id === id);
  if (!next || next.type === "text") return false;
  if (atom instanceof HTMLImageElement) {
    if (typeof next.attrs?.src === "string") atom.src = next.attrs.src;
    if (typeof next.attrs?.alt === "string") atom.alt = next.attrs.alt;
    if (typeof next.attrs?.title === "string") atom.title = next.attrs.title;
    if (Number(next.attrs?.width) > 0) atom.width = Number(next.attrs?.width);
    if (Number(next.attrs?.height) > 0) atom.height = Number(next.attrs?.height);
    const align = next.attrs?.align;
    if (align === "center") { atom.style.display = "block"; atom.style.margin = "0 auto"; atom.style.float = "none"; }
    else if (align === "left" || align === "right") { atom.style.display = "inline"; atom.style.float = align; atom.style.margin = align === "left" ? "0 8px 8px 0" : "0 0 8px 8px"; }
    atom.dataset.smartStatus = String(next.attrs?.status || "ready");
    if (typeof next.attrs?.error === "string") atom.dataset.smartError = next.attrs.error; else delete atom.dataset.smartError;
  }
  return true;
};

export const adjacentInlineAtom = (range: Range, direction: "backward" | "forward"): HTMLElement | null => {
  if (!range.collapsed || range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
  const container = range.startContainer as Element;
  const index = direction === "backward" ? range.startOffset - 1 : range.startOffset;
  const candidate = container.childNodes[index];
  return candidate instanceof HTMLElement && atomType(candidate) ? candidate : null;
};
