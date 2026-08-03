import {
  applyMarkCommand,
  applyOperations,
  clearAllMarksCommand,
  createFoundationEditor,
  createNodeId,
  createScopeIndex,
  editLinkCommand,
  executeMarkTool,
  foundationSchema,
  inlineToolDeclarations,
  parseCanonicalListHtml,
  removeLinkCommand,
  removeMarkCommand,
  serializeCanonicalListHtml,
  toggleMarkCommand,
  type Attrs,
  type InlineRangeScope,
  type InlineToolDeclaration,
  type SelectionDescription,
  type SmartDocument,
  type SmartMark,
  type SmartSelection,
} from "smartrte-core";

// MIGRATION_ADAPTER: canonical-inline-dom-roundtrip owner=Phase8
// ClassicEditor remains DOM-authoritative during staged migration. This adapter
// is scaffolding for deletion, not the final editor-state architecture.

export type CanonicalInlineToolId = typeof inlineToolDeclarations[number]["id"];
export type CanonicalInlineIntent = "apply" | "remove" | "toggle" | "setAttrs" | "clearAll" | "editLink";

interface DomPoint { readonly ownerId: string; readonly offset: number }
interface DomSelection { readonly anchor: DomPoint; readonly head: DomPoint }

const storedMarks = new WeakMap<HTMLElement, readonly SmartMark[]>();
const ownerSelector = "p,h1,h2,h3,h4,h5,h6";

const ownerId = (owner: HTMLElement) => {
  owner.dataset.smartId ||= createNodeId();
  return owner.dataset.smartId;
};

const contentWidth = (node: Node): number => {
  if (node.nodeType === node.TEXT_NODE) return node.nodeValue?.length || 0;
  if (!(node instanceof HTMLElement)) return [...node.childNodes].reduce((sum, child) => sum + contentWidth(child), 0);
  if (node.closest("[data-smart-ui]")) return 0;
  if (node.matches("br,[data-smart-atomic='true']")) return 1;
  return [...node.childNodes].reduce((sum, child) => sum + contentWidth(child), 0);
};

const pointInOwner = (root: HTMLElement, node: Node | null, offset: number): DomPoint | null => {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  const owner = element?.closest<HTMLElement>(ownerSelector);
  if (!owner || !root.contains(owner) || !node) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(owner);
  try { range.setEnd(node, offset); } catch { return null; }
  return { ownerId: ownerId(owner), offset: contentWidth(range.cloneContents()) };
};

const captureSelection = (root: HTMLElement): DomSelection | null => {
  const native = root.ownerDocument.defaultView?.getSelection();
  if (!native?.anchorNode || !native.focusNode) return null;
  const anchor = pointInOwner(root, native.anchorNode, native.anchorOffset);
  const head = pointInOwner(root, native.focusNode, native.focusOffset);
  return anchor && head ? { anchor, head } : null;
};

const domPointAt = (owner: HTMLElement, requested: number): { node: Node; offset: number } => {
  let remaining = Math.max(0, requested);
  const visit = (parent: Node): { node: Node; offset: number } | null => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (child.nodeType === child.TEXT_NODE) {
        const length = child.nodeValue?.length || 0;
        if (remaining <= length) return { node: child, offset: remaining };
        remaining -= length;
      } else if (child instanceof HTMLElement && child.matches("br,[data-smart-atomic='true']")) {
        if (remaining === 0) return { node: parent, offset: index };
        if (remaining === 1) return { node: parent, offset: index + 1 };
        remaining -= 1;
      } else if (!(child instanceof HTMLElement && child.closest("[data-smart-ui]"))) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(owner) || { node: owner, offset: owner.childNodes.length };
};

const restoreSelection = (root: HTMLElement, snapshot: DomSelection) => {
  const byId = (id: string) => Array.from(root.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .find((node) => node.matches(ownerSelector) && node.dataset.smartId === id) || null;
  const anchorOwner = byId(snapshot.anchor.ownerId);
  const headOwner = byId(snapshot.head.ownerId);
  const native = root.ownerDocument.defaultView?.getSelection();
  if (!anchorOwner || !headOwner || !native) return;
  const anchor = domPointAt(anchorOwner, snapshot.anchor.offset);
  const head = domPointAt(headOwner, snapshot.head.offset);
  native.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
};

const selectedOwners = (root: HTMLElement, snapshot: DomSelection) => {
  const owners = Array.from(root.querySelectorAll<HTMLElement>(ownerSelector));
  const indexes = [snapshot.anchor.ownerId, snapshot.head.ownerId].map((id) => owners.findIndex((owner) => ownerId(owner) === id));
  if (indexes.some((index) => index < 0)) return [];
  const [from, to] = [Math.min(...indexes), Math.max(...indexes)];
  return owners.slice(from, to + 1);
};

const modelSelection = (
  document: SmartDocument,
  snapshot: DomSelection,
): SmartSelection | null => {
  const positions = createScopeIndex().positions(document, foundationSchema);
  const point = (value: DomPoint) => {
    const content = positions.contentRangeOf(value.ownerId);
    return content ? { path: [...content.from.path], offset: value.offset } : null;
  };
  const anchor = point(snapshot.anchor);
  const head = point(snapshot.head);
  return anchor && head ? { type: "text", anchor, head } : null;
};

const parseOwners = (owners: readonly HTMLElement[]): SmartDocument =>
  parseCanonicalListHtml(owners.map((owner) => owner.outerHTML).join(""));

const renderOwners = (root: HTMLElement, owners: readonly HTMLElement[], document: SmartDocument, preserveEditedLink = false) => {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = serializeCanonicalListHtml(document, { fragment: true });
  owners.forEach((owner) => {
    const id = ownerId(owner);
    const replacement = Array.from(template.content.querySelectorAll<HTMLElement>("[data-smart-id]"))
      .find((candidate) => candidate.dataset.smartId === id);
    if (replacement) {
      const existingLinks = owner.querySelectorAll<HTMLAnchorElement>("a");
      const replacementLinks = replacement.querySelectorAll<HTMLAnchorElement>("a");
      if (preserveEditedLink && existingLinks.length === 1 && replacementLinks.length === 1
        && existingLinks[0].textContent === replacementLinks[0].textContent
        && owner.textContent === replacement.textContent) {
        const next = replacementLinks[0];
        existingLinks[0].setAttribute("href", next.getAttribute("href") || "");
        if (next.target) {
          existingLinks[0].target = next.target;
          existingLinks[0].rel = "noopener noreferrer";
        } else {
          existingLinks[0].removeAttribute("target");
          existingLinks[0].removeAttribute("rel");
        }
        return;
      }
      owner.innerHTML = replacement.innerHTML;
      owner.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
        const color = span.style.color;
        const background = span.style.backgroundColor;
        const size = span.style.fontSize;
        const family = span.style.fontFamily;
        span.removeAttribute("style");
        if (color) span.style.color = color;
        if (background) span.style.backgroundColor = background;
        if (size) span.style.fontSize = size;
        if (family) span.style.fontFamily = family;
      });
    }
  });
};

const declarationFor = (id: CanonicalInlineToolId): InlineToolDeclaration => {
  const declaration = inlineToolDeclarations.find((tool) => tool.id === id);
  if (!declaration) throw new Error(`Unknown inline tool "${id}".`);
  return declaration;
};

export interface CanonicalInlineExecution {
  readonly changed: boolean;
  readonly operations: number;
  readonly coverage: "all" | "partial" | "none";
}

export const executeCanonicalInlineTool = (
  root: HTMLElement,
  id: CanonicalInlineToolId,
  intent: CanonicalInlineIntent = "toggle",
  attrs?: Attrs,
): CanonicalInlineExecution => {
  const ownerElements = Array.from(root.querySelectorAll<HTMLElement>(ownerSelector));
  const ownersWithPersistedIds = new Set(ownerElements.filter((owner) => owner.hasAttribute("data-smart-id")));
  const cleanupTemporaryIds = () => ownerElements.forEach((owner) => {
    if (!ownersWithPersistedIds.has(owner)) owner.removeAttribute("data-smart-id");
  });
  const snapshot = captureSelection(root);
  if (!snapshot) return { changed: false, operations: 0, coverage: "none" };
  const owners = selectedOwners(root, snapshot);
  if (!owners.length) return { changed: false, operations: 0, coverage: "none" };
  const document = parseOwners(owners);
  const selection = modelSelection(document, snapshot);
  if (!selection) return { changed: false, operations: 0, coverage: "none" };
  const declaration = declarationFor(id);
  const index = createScopeIndex();
  const scope = index.resolve(document, selection, { want: "inline-range" }, foundationSchema) as InlineRangeScope;
  const description = index.resolve(document, selection, { want: "describe" }, foundationSchema) as SelectionDescription;
  const coverage = description.marks.some((entry) => entry.mark.type === declaration.markType && entry.coverage === "all")
    ? "all" : description.marks.some((entry) => entry.mark.type === declaration.markType) ? "partial" : "none";

  if (scope.collapsed && !(declaration.markType === "link" && (intent === "remove" || intent === "editLink"))) {
    const editor = createFoundationEditor({ document, selection, storedMarks: storedMarks.get(root) });
    executeMarkTool(editor, declaration, intent, attrs);
    storedMarks.set(root, [...(editor.storedMarks || [])]);
    cleanupTemporaryIds();
    return { changed: false, operations: 0, coverage };
  }

  const ctx = { schema: foundationSchema, positions: index.positions(document, foundationSchema) };
  const operations = intent === "clearAll" ? clearAllMarksCommand(document, scope, {}, ctx)
    : intent === "remove" && declaration.markType === "link" ? removeLinkCommand(document, scope, { markType: "link" }, ctx)
      : intent === "editLink" && declaration.markType === "link" ? editLinkCommand(document, scope, attrs as { href: string; target?: string }, ctx)
        : intent === "remove" ? removeMarkCommand(document, scope, { markType: declaration.markType }, ctx)
          : intent === "toggle" ? toggleMarkCommand(document, scope, { markType: declaration.markType, attrs, coverage }, ctx)
            : applyMarkCommand(document, scope, { markType: declaration.markType, attrs }, ctx);
  if (!operations.length) return { changed: false, operations: 0, coverage };
  const output = applyOperations(document, operations);
  renderOwners(root, owners, output, intent === "editLink");
  restoreSelection(root, snapshot);
  cleanupTemporaryIds();
  storedMarks.delete(root);
  return { changed: true, operations: operations.length, coverage };
};

/** Consumes adapter stored marks for ordinary text input. Composition remains
 * owned by the canonical surface; atom-aware composition is explicitly Phase 7. */
export const installCanonicalInlineStoredMarkInput = (root: HTMLElement): (() => void) => {
  const beforeInput = (event: InputEvent) => {
    if (!storedMarks.has(root) || event.inputType !== "insertText" || !event.data) return;
    const marks = storedMarks.get(root) || [];
    const ownerElements = Array.from(root.querySelectorAll<HTMLElement>(ownerSelector));
    const ownersWithPersistedIds = new Set(ownerElements.filter((owner) => owner.hasAttribute("data-smart-id")));
    const snapshot = captureSelection(root);
    if (!snapshot || snapshot.anchor.ownerId !== snapshot.head.ownerId || snapshot.anchor.offset !== snapshot.head.offset) return;
    event.preventDefault();
    const owners = selectedOwners(root, snapshot);
    const document = parseOwners(owners);
    const selection = modelSelection(document, snapshot);
    if (!selection) return;
    const editor = createFoundationEditor({ document, selection, storedMarks: marks });
    if (marks.length) editor.typeText(event.data, { timestamp: Date.now() });
    else editor.transact((builder) => {
      builder.operations.push({ type: "insertText", pos: selection.head, text: event.data! });
      const next = { path: [...selection.head.path], offset: selection.head.offset + event.data!.length };
      builder.setSelection({ type: "text", anchor: next, head: next });
      builder.setStoredMarks([]);
    }, { source: "input", timestamp: Date.now(), addToHistory: true });
    renderOwners(root, owners, editor.document);
    const next = { anchor: { ...snapshot.anchor, offset: snapshot.anchor.offset + event.data.length }, head: { ...snapshot.head, offset: snapshot.head.offset + event.data.length } };
    restoreSelection(root, next);
    ownerElements.forEach((owner) => { if (!ownersWithPersistedIds.has(owner)) owner.removeAttribute("data-smart-id"); });
    storedMarks.set(root, [...(editor.storedMarks || [])]);
  };
  const selectionChange = () => {
    const ownerElements = Array.from(root.querySelectorAll<HTMLElement>(ownerSelector));
    const ownersWithPersistedIds = new Set(ownerElements.filter((owner) => owner.hasAttribute("data-smart-id")));
    const snapshot = captureSelection(root);
    if (!snapshot || snapshot.anchor.ownerId !== snapshot.head.ownerId || snapshot.anchor.offset !== snapshot.head.offset) storedMarks.delete(root);
    ownerElements.forEach((owner) => { if (!ownersWithPersistedIds.has(owner)) owner.removeAttribute("data-smart-id"); });
  };
  root.addEventListener("beforeinput", beforeInput);
  root.ownerDocument.addEventListener("selectionchange", selectionChange);
  return () => {
    root.removeEventListener("beforeinput", beforeInput);
    root.ownerDocument.removeEventListener("selectionchange", selectionChange);
    storedMarks.delete(root);
  };
};

export const canonicalInlineStoredMarks = (root: HTMLElement): readonly SmartMark[] => storedMarks.get(root) || [];
export const hasCanonicalInlineStoredMarkOverride = (root: HTMLElement): boolean => storedMarks.has(root);

export const describeCanonicalInlineCoverage = (root: HTMLElement): Readonly<Record<string, "all" | "partial">> => {
  if (storedMarks.has(root)) return Object.fromEntries((storedMarks.get(root) || []).map((mark) => [mark.type, "all"]));
  const ownerElements = Array.from(root.querySelectorAll<HTMLElement>(ownerSelector));
  const ownersWithPersistedIds = new Set(ownerElements.filter((owner) => owner.hasAttribute("data-smart-id")));
  const snapshot = captureSelection(root);
  if (!snapshot) return {};
  const owners = selectedOwners(root, snapshot);
  const document = parseOwners(owners);
  const selection = modelSelection(document, snapshot);
  const description = selection
    ? createScopeIndex().resolve(document, selection, { want: "describe" }, foundationSchema) as SelectionDescription
    : null;
  ownerElements.forEach((owner) => { if (!ownersWithPersistedIds.has(owner)) owner.removeAttribute("data-smart-id"); });
  return Object.fromEntries((description?.marks || []).map((entry) => [entry.mark.type, entry.coverage]));
};
