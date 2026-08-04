import {
  applyOperations,
  createNodeId,
  createScopeIndex,
  foundationSchema,
  indentBlockCommand,
  indentInsideCodeBlock,
  insertCodeBlockNewline,
  isTextNode,
  moveBlockCommand,
  outdentBlockCommand,
  exitCodeBlock,
  parseCanonicalBlockHtml,
  serializeCanonicalBlockHtml,
  setBlockAttributes,
  setBlockTypeCommand,
  unwrapBlocks,
  wrapBlocks,
  type BlockRangeScope,
  type SmartDocument,
} from "smartrte-core";
import type { SetBlockTypeInput, TextAlignment } from "smartrte-core/legacy";

// MIGRATION_ADAPTER: canonical-block-dom-roundtrip owner=Phase8
// ClassicEditor remains DOM-authoritative during staged migration. This is
// deletion scaffolding, not the final canonical editor-state architecture.

export type DomBlockCommand =
  | { id: "block-type.set"; input: Pick<SetBlockTypeInput, "type" | "level"> }
  | { id: "alignment.set"; input: { alignment: TextAlignment | null } }
  | { id: "blockquote.toggle" }
  | { id: "code-block.toggle"; input?: { active: boolean } }
  | { id: "block.indent" }
  | { id: "block.outdent" }
  | { id: "block.move"; input: { direction: "up" | "down" } };

interface DomPoint { readonly ownerId: string; readonly offset: number }
interface DomSelectionSnapshot { readonly anchor: DomPoint; readonly head: DomPoint }

const semanticSelector = "p,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,li";
const textOwnerSelector = "p,h1,h2,h3,h4,h5,h6,pre";
const nodeId = (element: HTMLElement) => {
  element.dataset.smartId ||= createNodeId();
  return element.dataset.smartId;
};

const ensureIds = (root: HTMLElement) => {
  if (root.matches(semanticSelector)) nodeId(root);
  root.querySelectorAll<HTMLElement>(semanticSelector).forEach(nodeId);
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
  const owner = element?.closest<HTMLElement>(textOwnerSelector);
  if (!owner || !root.contains(owner) || !node) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(owner);
  try { range.setEnd(node, offset); } catch { return null; }
  return { ownerId: nodeId(owner), offset: contentWidth(range.cloneContents()) };
};

const captureSelection = (root: HTMLElement): DomSelectionSnapshot | null => {
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

const restoreSelection = (root: HTMLElement, snapshot: DomSelectionSnapshot | null) => {
  if (!snapshot) return;
  const byId = (id: string) => Array.from(root.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .find((element) => element.dataset.smartId === id && element.matches(textOwnerSelector)) || null;
  const anchorOwner = byId(snapshot.anchor.ownerId);
  const headOwner = byId(snapshot.head.ownerId);
  const native = root.ownerDocument.defaultView?.getSelection();
  if (!anchorOwner || !headOwner || !native) return;
  const anchor = domPointAt(anchorOwner, snapshot.anchor.offset);
  const head = domPointAt(headOwner, snapshot.head.offset);
  native.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
};

const isContiguousSiblingRun = (blocks: readonly HTMLElement[]) => {
  if (!blocks.length || !blocks[0].parentElement) return false;
  const parent = blocks[0].parentElement;
  if (!blocks.every((block) => block.parentElement === parent)) return false;
  const siblings = Array.from(parent.children);
  const indexes = blocks.map((block) => siblings.indexOf(block));
  return indexes.every((index, offset) => index >= 0 && (offset === 0 || index === indexes[offset - 1] + 1));
};

const blockScope = (document: SmartDocument, ids: readonly string[]): BlockRangeScope => ({
  kind: "block-range", blockIds: [...ids], promotedFromPartial: false,
  commonParentId: document.id,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: document.children.length } },
  isolatingAncestorId: null, clamped: false,
});

const preservePresentationalAttributes = (before: ReadonlyMap<string, HTMLElement>, root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("[data-smart-id]").forEach((element) => {
    const previous = before.get(element.dataset.smartId || "");
    if (!previous) return;
    if (previous.className) element.className = previous.className;
    const align = element.style.textAlign;
    const indent = element.style.marginInlineStart;
    const originalStyle = previous.getAttribute("style");
    if (originalStyle) element.setAttribute("style", originalStyle);
    if (align) element.style.textAlign = align;
    else if (element.dataset.smartAlign === "left") element.style.removeProperty("text-align");
    if (indent) element.style.marginInlineStart = indent;
    if (!element.getAttribute("style")) element.removeAttribute("style");
  });
};

/** Executes every product block affordance through the pure foundation command
 * family. Transactions and selection restoration remain caller/adapter owned. */
export const executeDomBlockCommand = (
  blocks: readonly HTMLElement[],
  command: DomBlockCommand,
): HTMLElement[] | null => {
  if (!isContiguousSiblingRun(blocks)) return null;
  const parent = blocks[0].parentElement!;
  ensureIds(parent);
  const selectedIds = blocks.map(nodeId);
  const selection = captureSelection(parent);
  const previous = new Map(Array.from(parent.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .map((element) => [element.dataset.smartId || "", element.cloneNode(true) as HTMLElement]));
  const document = parseCanonicalBlockHtml(parent.innerHTML);
  const index = createScopeIndex();
  const ctx = { schema: foundationSchema, positions: index.positions(document, foundationSchema) };
  const targetIds = selectedIds.map((id) => {
    const resolved = ctx.positions.positionOf(id);
    const node = resolved?.parent.children?.[resolved.pos.offset];
    if (!node || isTextNode(node) || node.type !== "list_item") return id;
    const content = node.children?.find((child) => !isTextNode(child) && child.type !== "list");
    return content && !isTextNode(content) ? content.id : id;
  });
  const scope = blockScope(document, targetIds);
  const selectedNodes = targetIds.map((id) => {
    const resolved = ctx.positions.positionOf(id);
    return resolved?.parent.children?.[resolved.pos.offset];
  });
  if (selectedNodes.some((node) => !node || node.type === "text")) return null;
  const operations = command.id === "block-type.set"
    ? setBlockTypeCommand(document, scope, { type: command.input.type, ...(command.input.type === "heading" ? { attrs: { level: command.input.level || 1 } } : {}) }, ctx)
    : command.id === "alignment.set"
      ? setBlockAttributes(document, scope, { attrs: { align: command.input.alignment || undefined } }, ctx)
      : command.id === "blockquote.toggle"
        ? selectedNodes.every((node) => node?.type === "blockquote")
          ? unwrapBlocks(document, scope, { type: "blockquote" }, ctx)
          : wrapBlocks(document, scope, { type: "blockquote", wrapperIds: [createNodeId()] }, ctx)
        : command.id === "code-block.toggle"
          ? setBlockTypeCommand(document, scope, { type: (command.input?.active ?? !selectedNodes.every((node) => node?.type === "code_block")) ? "code_block" : "paragraph" }, ctx)
          : command.id === "block.indent" ? indentBlockCommand(document, scope, {}, ctx)
            : command.id === "block.outdent" ? outdentBlockCommand(document, scope, {}, ctx)
              : moveBlockCommand(document, scope, command.input, ctx);
  if (!operations.length) return null;
  const output = applyOperations(document, operations);
  if (["alignment.set", "block.indent", "block.outdent"].includes(command.id)
    && targetIds.every((id, offset) => id === selectedIds[offset])) {
    const outputPositions = createScopeIndex().positions(output, foundationSchema);
    blocks.forEach((block, offset) => {
      const id = selectedIds[offset];
      const resolved = outputPositions.positionOf(id);
      const node = resolved?.parent.children?.[resolved.pos.offset];
      if (!node || isTextNode(node)) return;
      const align = typeof node.attrs?.align === "string" ? node.attrs.align : "";
      const indent = Math.max(0, Number(node.attrs?.indentLevel) || 0);
      if (align && align !== "left") block.style.textAlign = align;
      else block.style.removeProperty("text-align");
      if (align) block.dataset.smartAlign = align; else delete block.dataset.smartAlign;
      if (indent) {
        block.dataset.smartIndent = String(indent);
        block.style.marginInlineStart = `${indent * 2}em`;
      } else {
        delete block.dataset.smartIndent;
        block.style.removeProperty("margin-inline-start");
      }
      if (!block.getAttribute("style")) block.removeAttribute("style");
    });
    return [...blocks];
  }
  const template = parent.ownerDocument.createElement("template");
  template.innerHTML = serializeCanonicalBlockHtml(output, { fragment: true });
  parent.replaceChildren(template.content);
  preservePresentationalAttributes(previous, parent);
  restoreSelection(parent, selection);
  const selectedAfter = selectedIds.flatMap((id) => {
    const element = Array.from(parent.querySelectorAll<HTMLElement>("[data-smart-id]"))
      .find((candidate) => candidate.dataset.smartId === id);
    return element ? [element] : [];
  });
  return selectedAfter.length ? selectedAfter : Array.from(parent.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
};

export type DomCodeInputIntent = "newline" | "tab" | "exit";

/** Product adapter for the Phase 5 code-block input semantics. Browser input
 * is converted to a foundation operation before the DOM is updated. */
export const executeDomCodeInput = (root: HTMLElement, intent: DomCodeInputIntent): boolean => {
  const native = root.ownerDocument.defaultView?.getSelection();
  if (!native?.anchorNode || !native.focusNode || native.anchorNode !== native.focusNode || native.anchorOffset !== native.focusOffset) return false;
  const element = native.anchorNode instanceof HTMLElement ? native.anchorNode : native.anchorNode.parentElement;
  const code = element?.closest<HTMLElement>("pre");
  if (!code || !root.contains(code) || !code.parentElement) return false;
  const parent = code.parentElement;
  ensureIds(parent);
  const snapshot = captureSelection(parent);
  if (!snapshot || snapshot.anchor.ownerId !== snapshot.head.ownerId || snapshot.anchor.offset !== snapshot.head.offset) return false;
  const document = parseCanonicalBlockHtml(parent.innerHTML);
  const positions = createScopeIndex().positions(document, foundationSchema);
  const content = positions.contentRangeOf(snapshot.head.ownerId);
  if (!content) return false;
  const pos = { path: [...content.from.path], offset: snapshot.head.offset };
  const result = intent === "newline" ? insertCodeBlockNewline(document, pos, { exitOnTrailingEmptyLine: true, paragraphId: createNodeId() })
    : intent === "tab" ? indentInsideCodeBlock(document, pos)
      : exitCodeBlock(document, pos, createNodeId());
  if (!result?.operations.length) return false;
  const output = applyOperations(document, result.operations);
  const previous = new Map(Array.from(parent.querySelectorAll<HTMLElement>("[data-smart-id]"))
    .map((node) => [node.dataset.smartId || "", node.cloneNode(true) as HTMLElement]));
  const template = parent.ownerDocument.createElement("template");
  template.innerHTML = serializeCanonicalBlockHtml(output, { fragment: true });
  parent.replaceChildren(template.content);
  preservePresentationalAttributes(previous, parent);
  restoreSelection(parent, {
    anchor: { ownerId: result.selectionTarget.ownerId, offset: result.selectionTarget.offset },
    head: { ownerId: result.selectionTarget.ownerId, offset: result.selectionTarget.offset },
  });
  return true;
};
