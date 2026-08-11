import { createNodeId, isTextNode } from "../identity.js";
import {
  backspaceAtListItemStart,
  deleteAtListItemEnd,
  enterInList,
  indentList,
  listItemAt,
  outdentList,
  setListChecked,
  type CommandContext,
  type ListInputResult,
} from "../list/index.js";
import { applyOperations } from "../operations.js";
import { nodeAtPath, comparePos, inlineGraphemeBoundaries } from "../positions.js";
import { createScopeIndex } from "../scope/index.js";
import { TransactionBuilder, type FoundationEditor } from "../editor.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos, SmartRange, SmartSelection } from "../types.js";
import type { ResolvedScope } from "../scope/types.js";
import type { CanonicalInputPipeline, CanonicalSubtreeRenderer } from "./types.js";
import type { SmartMark } from "../types.js";
import {
  executeMarkTool,
  canonicalMarkOrder,
  inlineToolDeclarations,
  insertHardBreak,
  markKey,
  marksAtInsertion,
} from "../marks/index.js";
import {
  exitCodeBlock,
  indentInsideCodeBlock,
  insertCodeBlockNewline,
  type CodeBlockInputResult,
} from "../block/index.js";
import { tokenizeCompositionOwner, type CompositionToken } from "../atom/index.js";
import {
  deleteClipboardSelection,
  insertClipboardFragment,
  parseClipboardPayload,
  reportParsedClipboard,
  reportRejectedClipboard,
  remintClipboardFragmentIds,
  serializeClipboardRepresentations,
  sliceClipboardSelection,
  type ClipboardInsertionResult,
  type RawClipboardPayload,
} from "../clipboard/index.js";
import { cellSelectionFromIds } from "../table/selection.js";
import { FoundationTransactionMap } from "../mapping.js";
import type { CanonicalInputPipelineOptions } from "./types.js";
import { resolvePrecedingContentTarget } from "../structural/contentTarget.js";
import { SMART_UI_ATTRIBUTE } from "../modelDom.js";

interface CompositionState {
  id: string;
  ownerId: string;
  ownerPath: number[];
  beforeText: string;
  selectionBefore: SmartSelection;
  observer: MutationObserver | null;
  beforeTokens: CompositionToken[];
  activeMarks: SmartMark[];
}

interface InternalDragState {
  selection: SmartSelection;
  fragment: SmartDocument;
}

const samePos = (left: SmartPos, right: SmartPos) => comparePos(left, right) === 0;
const normalizedRange = (selection: SmartSelection): SmartRange => comparePos(selection.anchor, selection.head) <= 0
  ? { from: selection.anchor, to: selection.head }
  : { from: selection.head, to: selection.anchor };
const collapsed = (selection: SmartSelection) => samePos(selection.anchor, selection.head);
const inlineText = (owner: SmartElementNode) => (owner.children || []).map((node) => isTextNode(node) ? node.text : "\uFFFC").join("");
interface CompositionUnit { char: string; marks: SmartMark[]; key: string; kind: "text" | "atom" }
const tokenUnits = (tokens: readonly CompositionToken[]): CompositionUnit[] => {
  const units: CompositionUnit[] = [];
  tokens.forEach((token) => {
    if (token.kind === "atom") units.push({ char: "\uFFFC", marks: [], key: `atom:${token.nodeId}`, kind: "atom" });
    else for (let index = 0; index < token.text.length; index += 1) {
      units.push({ char: token.text[index], marks: [...token.marks], key: token.marks.map(markKey).join("|"), kind: "text" });
    }
  });
  return units;
};

const ownerAt = (editor: FoundationEditor, pos: SmartPos): SmartElementNode => {
  const node = nodeAtPath(editor.document, pos.path);
  if (!node || isTextNode(node)) throw new Error("Input position must resolve to an inline owner.");
  return node;
};

/**
 * Returns editable inline owners in logical document order. This is used only
 * when a deletion crosses a structural boundary; ordinary character deletion
 * remains path-local. Structural containers (lists, quotes, cells) are
 * intentionally transparent here, while atomic nodes remain opaque.
 */
const editableOwners = (
  node: SmartNode,
  path: readonly number[],
  schema: FoundationEditor["schema"],
  output: Array<{ node: SmartElementNode; path: number[] }> = [],
): Array<{ node: SmartElementNode; path: number[] }> => {
  if (isTextNode(node) || schema.nodes[node.type]?.atomic === true) return output;
  if (isInlineOwnerNode(node, schema)) {
    output.push({ node, path: [...path] });
    return output;
  }
  node.children?.forEach((child, index) => editableOwners(child, [...path, index], schema, output));
  return output;
};

const emptyParagraph = (id: string): SmartElementNode => ({ type: "paragraph", id, children: [] });

const isInlineOwnerNode = (node: SmartNode, schema: FoundationEditor["schema"]): boolean => {
  if (isTextNode(node) || schema.nodes[node.type]?.atomic === true) return false;
  if (["paragraph", "heading", "code_block"].includes(node.type)) return true;
  return /(?:^|[|(\s])(?:inline|text)(?:[+*?]|$)/.test(schema.nodes[node.type]?.content || "");
};

/** Finds the nearest editable inline owner inside a structural sibling. */
const editableOwnerPosition = (
  node: SmartNode,
  path: readonly number[],
  direction: -1 | 1,
  schema: FoundationEditor["schema"],
): SmartPos | null => {
  if (isTextNode(node) || schema.nodes[node.type]?.atomic === true) return null;
  if (isInlineOwnerNode(node, schema)) return {
    path: [...path],
    offset: direction > 0 ? 0 : inlineText(node).length,
  };
  const children = node.children || [];
  const indexes = Array.from({ length: children.length }, (_, index) => index);
  if (direction < 0) indexes.reverse();
  for (const index of indexes) {
    const found = editableOwnerPosition(children[index], [...path, index], direction, schema);
    if (found) return found;
  }
  return null;
};

/**
 * DOM selections can legally collapse on a structural element boundary (for
 * example, the editable root at child offset `children.length`).  Structural
 * positions are useful for operations, but they are not caret owners. Resolve
 * those boundary points to the nearest inline owner before they enter the
 * canonical selection state. Direct editable siblings are preferred over an
 * owner nested inside a structural sibling so a caret between quotes lands in
 * the boundary paragraph rather than inside the preceding quote.
 */
const editablePositionForStructuralBoundary = (
  editor: FoundationEditor,
  position: SmartPos,
  bias: -1 | 1,
): SmartPos | null => {
  const node = nodeAtPath(editor.document, position.path);
  if (!node || isTextNode(node) || isInlineOwnerNode(node, editor.schema)) return position;
  const children = node.children || [];
  const offset = Math.max(0, Math.min(position.offset, children.length));
  const direct = (index: number, direction: -1 | 1): SmartPos | null => {
    const child = children[index];
    if (!child || isTextNode(child) || !isInlineOwnerNode(child, editor.schema)) return null;
    return {
      path: [...position.path, index],
      offset: direction < 0 ? inlineText(child).length : 0,
    };
  };
  const directOrder = bias < 0 ? [offset - 1, offset] : [offset, offset - 1];
  for (const index of directOrder) {
    const found = direct(index, bias);
    if (found) return found;
  }
  const nestedOrder = bias < 0 ? [offset - 1, offset] : [offset, offset - 1];
  for (const index of nestedOrder) {
    const child = children[index];
    if (!child || isTextNode(child)) continue;
    const found = editableOwnerPosition(child, [...position.path, index], bias, editor.schema);
    if (found) return found;
  }
  return null;
};

const textSegments = (owner: SmartElementNode) => {
  let offset = 0;
  return (owner.children || []).map((node, index) => {
    const from = offset;
    offset += isTextNode(node) ? node.text.length : 1;
    return { node, index, from, to: offset };
  });
};

/**
 * Split an inline owner without flattening its children.  Enter is a block
 * operation, but the content crossing the split still belongs to the same
 * inline runs: marks, hard breaks, and inline atoms must survive byte-for-byte
 * on the new block.  Text children are copied only when they are cut in two;
 * unsplit children retain their identity until the operation boundary clones
 * the inserted node.
 */
const splitInlineChildren = (children: readonly SmartNode[], offset: number): [SmartNode[], SmartNode[]] => {
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let consumed = 0;
  let split = false;
  for (const child of children) {
    if (split) {
      after.push(child);
      continue;
    }
    const width = isTextNode(child) ? child.text.length : 1;
    const local = offset - consumed;
    if (local >= width) {
      before.push(child);
      consumed += width;
      continue;
    }
    if (isTextNode(child)) {
      if (local > 0) before.push({ ...child, text: child.text.slice(0, local) });
      if (local < width) after.push({ ...child, text: child.text.slice(local) });
    } else if (local === 0) {
      after.push(child);
    } else {
      // Inline atoms occupy one indivisible unit. A valid position cannot be
      // inside one; this branch is only the defensive side of that contract.
      before.push(child);
    }
    split = true;
    consumed += width;
  }
  return [before, after];
};

const queueInlineDeletion = (builder: TransactionBuilder, ownerPath: number[], owner: SmartElementNode, from: number, to: number) => {
  const segments = textSegments(owner).filter((segment) => segment.from < to && segment.to > from).reverse();
  segments.forEach((segment) => {
    if (isTextNode(segment.node)) {
      const localFrom = Math.max(from, segment.from) - segment.from;
      const localTo = Math.min(to, segment.to) - segment.from;
      const text = segment.node.text.slice(localFrom, localTo);
      if (text) builder.operations.push({
        type: "deleteText",
        pos: { path: [...ownerPath], offset: segment.from + localFrom },
        text,
        ...(segment.node.marks?.length ? { marks: [...segment.node.marks] } : {}),
      });
    } else if (from <= segment.from && to >= segment.to) {
      builder.operations.push({ type: "removeNode", pos: { path: [...ownerPath], offset: segment.index }, node: segment.node });
    }
  });
};

const isDocumentStart = (editor: FoundationEditor, pos: SmartPos): boolean => {
  if (pos.offset !== 0) return false;
  let node: SmartNode = editor.document;
  for (const index of pos.path) {
    if (index !== 0 || isTextNode(node) || !node.children?.[index]) return false;
    node = node.children[index];
  }
  return true;
};

const isDocumentEnd = (
  editor: FoundationEditor,
  pos: SmartPos,
): boolean => {
  let node: SmartNode = editor.document;
  if (pos.path.length === 0) return pos.offset === editor.document.children.length;
  for (const index of pos.path) {
    if (isTextNode(node) || !node.children?.[index] || index !== node.children.length - 1) return false;
    node = node.children[index];
  }
  const limit = isTextNode(node) ? 0 : isInlineOwnerNode(node, editor.schema)
    ? inlineText(node).length
    : node.children?.length || 0;
  return pos.offset === limit;
};

const isWholeDocumentRange = (editor: FoundationEditor, range: SmartRange): boolean => {
  return isDocumentStart(editor, range.from) && isDocumentEnd(editor, range.to);
};

/**
 * Clearing a whole-document selection must still leave the schema-valid
 * editable anchor the browser expects. Keep the operation explicit rather
 * than relying on repair(), because transaction validation deliberately runs
 * before repair and a doc node is required to contain at least one block.
 */
const queueWholeDocumentDeletion = (editor: FoundationEditor, builder: TransactionBuilder): SmartPos => {
  const children = editor.document.children || [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    builder.operations.push({ type: "removeNode", pos: { path: [], offset: index }, node: children[index] });
  }
  const paragraph = emptyParagraph(createNodeId());
  builder.operations.push({ type: "insertNode", pos: { path: [], offset: 0 }, node: paragraph });
  return { path: [0], offset: 0 };
};

const queueRangeDeletion = (editor: FoundationEditor, builder: TransactionBuilder, range: SmartRange): SmartPos => {
  const fromOwner = ownerAt(editor, range.from);
  const toOwner = ownerAt(editor, range.to);
  if (range.from.path.length === range.to.path.length && range.from.path.every((part, index) => part === range.to.path[index])) {
    queueInlineDeletion(builder, range.from.path, fromOwner, range.from.offset, range.to.offset);
    return { path: [...range.from.path], offset: range.from.offset };
  }
  const parentPath = range.from.path.slice(0, -1);
  const toParentPath = range.to.path.slice(0, -1);
  if (parentPath.length !== toParentPath.length || parentPath.some((part, index) => part !== toParentPath[index])) {
    throw new Error("Cross-parent text deletion is outside the canonical test surface contract.");
  }
  const fromIndex = range.from.path[range.from.path.length - 1];
  const toIndex = range.to.path[range.to.path.length - 1];
  if (fromOwner.type !== toOwner.type || fromIndex >= toIndex) throw new Error("Cross-block deletion requires compatible forward sibling blocks.");
  queueInlineDeletion(builder, range.to.path, toOwner, 0, range.to.offset);
  queueInlineDeletion(builder, range.from.path, fromOwner, range.from.offset, inlineText(fromOwner).length);
  const parent = nodeAtPath(editor.document, parentPath);
  if (!parent || isTextNode(parent) || !parent.children) throw new Error("Cross-block deletion parent is invalid.");
  for (let index = toIndex - 1; index > fromIndex; index -= 1) {
    builder.operations.push({ type: "removeNode", pos: { path: [...parentPath], offset: index }, node: parent.children[index] });
  }
  builder.operations.push({
    type: "mergeNode",
    pos: { path: [...parentPath], offset: fromIndex + 1 },
    depth: 0,
    retiredId: toOwner.id,
    splitOffset: textSegments(fromOwner).filter((segment) => segment.from < range.from.offset).length,
  });
  return { path: [...range.from.path], offset: range.from.offset };
};

const samePath = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const pathStartsWith = (path: readonly number[], prefix: readonly number[]) =>
  prefix.length < path.length && prefix.every((part, index) => path[index] === part);

const firstEditableOwnerId = (
  node: SmartNode,
  schema: FoundationEditor["schema"],
): string | null => {
  if (isTextNode(node) || schema.nodes[node.type]?.atomic === true) return null;
  if (isInlineOwnerNode(node, schema)) return node.id;
  for (const child of node.children || []) {
    const found = firstEditableOwnerId(child, schema);
    if (found) return found;
  }
  return null;
};

const scopeTargetIds = (scope: ResolvedScope): string[] => {
  if (scope.kind === "list-selection") return scope.items.map((item) => item.itemId);
  if (scope.kind === "block-range") return [...scope.blockIds];
  if (scope.kind === "container-tree") return [scope.rootId];
  if (scope.kind === "atomic-node") return [scope.nodeId];
  if (scope.kind === "mixed") return scope.parts.flatMap(scopeTargetIds);
  return [];
};

interface StructuralDeletionPlan {
  operations: SmartOperation[];
  preferredOwnerIds: string[];
}

/**
 * Deletes a structural selection by IDs rather than by assuming both inline
 * endpoints share one parent.  The old range path was intentionally narrow
 * for character deletion; it threw for list items and for node selections of
 * blockquote/code nodes, which the browser quite legitimately reports as
 * different scope kinds.
 */
const structuralDeletionPlan = (
  editor: FoundationEditor,
  selection: SmartSelection,
  range: SmartRange,
): StructuralDeletionPlan | null => {
  const ids: string[] = [];
  if (selection.type === "node" || selection.type === "cell") {
    const parent = nodeAtPath(editor.document, range.from.path);
    if (!parent || isTextNode(parent) || !parent.children) return null;
    for (let index = range.from.offset; index < range.to.offset; index += 1) {
      const child = parent.children[index];
      if (child && !isTextNode(child)) ids.push(child.id);
    }
  } else {
    const scope = editor.resolveScope({ want: "list-selection" }, selection);
    if ("kind" in scope) ids.push(...scopeTargetIds(scope));
    if (!ids.length) {
      const blocks = editor.resolveScope({ want: "block-range" }, selection);
      if ("kind" in blocks) ids.push(...scopeTargetIds(blocks));
    }
    if (!ids.length) {
      const containers = editor.resolveScope({ want: "container-tree" }, selection);
      if ("kind" in containers) ids.push(...scopeTargetIds(containers));
    }
  }
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return null;

  const located = uniqueIds.flatMap((id) => {
    const position = editor.positions.positionOf(id);
    if (!position) return [];
    return [{ id, position, node: position.parent.children?.[position.pos.offset] }];
  }).filter((entry): entry is { id: string; position: NonNullable<ReturnType<FoundationEditor["positions"]["positionOf"]>>; node: SmartNode } =>
    Boolean(entry.node && !isTextNode(entry.node)));
  if (!located.length) return null;

  // If a parent itself is selected, descendants are already removed with it;
  // emitting both would address stale paths in one transaction.
  const targetPaths = located.map((entry) => ({ ...entry, path: [...entry.position.pos.path, entry.position.pos.offset] }));
  const targets = targetPaths.filter((entry) => !targetPaths.some((candidate) =>
    candidate !== entry && pathStartsWith(entry.path, candidate.path)));
  const byParent = new Map<string, typeof targets>();
  targets.forEach((entry) => {
    const key = entry.position.pos.path.join("/");
    byParent.set(key, [...(byParent.get(key) || []), entry]);
  });

  // Select-all is a structural range at the document root. Keep the explicit
  // empty-document anchor instead of leaving repair to invent one later.
  const root = nodeAtPath(editor.document, []);
  const rootGroup = byParent.get("");
  if (root && !isTextNode(root) && rootGroup && rootGroup.length === (root.children || []).length
    && rootGroup.every((entry) => entry.position.pos.path.length === 0)) {
    const operations: SmartOperation[] = [];
    for (let index = (root.children || []).length - 1; index >= 0; index -= 1) {
      operations.push({ type: "removeNode", pos: { path: [], offset: index }, node: root.children![index] });
    }
    const paragraph = emptyParagraph(createNodeId());
    operations.push({ type: "insertNode", pos: { path: [], offset: 0 }, node: paragraph });
    return { operations, preferredOwnerIds: [paragraph.id] };
  }

  const operations: SmartOperation[] = [];
  const preferredOwnerIds: string[] = [];
  byParent.forEach((entries) => {
    const parent = entries[0].position.parent;
    const children = parent.children || [];
    const indexes = entries.map((entry) => entry.position.pos.offset).sort((left, right) => left - right);
    const allChildren = indexes.length === children.length && indexes.every((value, index) => value === index);
    if (allChildren && parent.type === "list") {
      const listPosition = editor.positions.positionOf(parent.id);
      if (listPosition) {
        const paragraph = emptyParagraph(createNodeId());
        operations.push({ type: "replaceNode", pos: listPosition.pos, before: parent, after: paragraph });
        preferredOwnerIds.push(paragraph.id);
        return;
      }
    }
    if (allChildren && (parent.type === "list_item" || parent.type === "blockquote" || parent.type === "table_cell")) {
      const parentPosition = editor.positions.positionOf(parent.id);
      if (parentPosition) {
        const paragraph = emptyParagraph(createNodeId());
        operations.push({ type: "replaceNode", pos: parentPosition.pos, before: parent, after: { ...parent, children: [paragraph] } });
        preferredOwnerIds.push(paragraph.id);
        return;
      }
    }
    // Descending offsets keep every remaining path stable when several
    // siblings are deleted from the same list/table/document container.
    [...entries].sort((left, right) => right.position.pos.offset - left.position.pos.offset).forEach((entry) => {
      operations.push({ type: "removeNode", pos: entry.position.pos, node: entry.node });
    });
    const next = children[indexes[indexes.length - 1] + 1] || children[indexes[0] - 1];
    if (next && !isTextNode(next)) {
      const owner = firstEditableOwnerId(next, editor.schema);
      if (owner) preferredOwnerIds.push(owner);
    }
  });
  if (!operations.length) return null;
  return { operations, preferredOwnerIds };
};

const previousWord = (text: string, offset: number) => {
  const prefix = text.slice(0, offset);
  const match = prefix.match(/(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)$/u);
  return Math.max(0, offset - (match?.[0].length || 1));
};
const nextWord = (text: string, offset: number) => {
  const match = text.slice(offset).match(/^(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)/u);
  return Math.min(text.length, offset + (match?.[0].length || 1));
};

export class FoundationInputPipeline implements CanonicalInputPipeline {
  private composition: CompositionState | null = null;
  private readonly unhandled: string[] = [];
  private readonly ownerDocument: Document;
  private destroyed = false;
  private internalDrag: InternalDragState | null = null;
  private tableDragAnchor: { id: string; tableId: string } | null = null;

  constructor(
    readonly editor: FoundationEditor,
    readonly renderer: CanonicalSubtreeRenderer,
    private readonly root: HTMLElement,
    private readonly options: CanonicalInputPipelineOptions = {},
  ) {
    this.ownerDocument = root.ownerDocument;
    root.addEventListener("beforeinput", this.beforeInputListener);
    root.addEventListener("keydown", this.keyDownListener);
    root.addEventListener("compositionstart", this.compositionStartListener);
    root.addEventListener("compositionupdate", this.compositionUpdateListener);
    root.addEventListener("compositionend", this.compositionEndListener);
    root.addEventListener("click", this.clickListener);
    root.addEventListener("mousedown", this.tableMouseDownListener);
    root.addEventListener("mouseup", this.tableMouseUpListener);
    this.ownerDocument.addEventListener("selectionchange", this.selectionChangeListener);
    root.addEventListener("paste", this.pasteListener);
    root.addEventListener("copy", this.copyListener);
    root.addEventListener("cut", this.cutListener);
    root.addEventListener("dragstart", this.dragStartListener);
    root.addEventListener("drop", this.dropListener);
    renderer.render(editor.document, editor.selection);
    editor.resolveScope({ want: "describe" });
  }

  get unhandledInputTypes(): readonly string[] { return this.unhandled; }

  private beforeInputListener = (event: Event) => this.handleBeforeInput(event as InputEvent);
  private keyDownListener = (event: Event) => this.handleKeyDown(event as KeyboardEvent);
  private compositionStartListener = (event: Event) => this.handleCompositionStart(event as CompositionEvent);
  private compositionUpdateListener = (event: Event) => this.handleCompositionUpdate(event as CompositionEvent);
  private compositionEndListener = (event: Event) => this.handleCompositionEnd(event as CompositionEvent);
  private tableMouseDownListener = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${SMART_UI_ATTRIBUTE}="check-control"]`) : null;
    if (target) {
      // A projected checkbox must not move the editable selection to the
      // button itself. The click handler below keeps the existing model
      // selection while toggling the item.
      event.preventDefault();
      this.root.focus();
      return;
    }
    if (this.composition) return;
    const cell = this.cellFromNode(event.target);
    this.tableDragAnchor = cell;
  };
  private tableMouseUpListener = (event: Event) => {
    const anchor = this.tableDragAnchor;
    this.tableDragAnchor = null;
    if (!anchor || this.composition) return;
    const head = this.cellFromNode(event.target);
    if (!head || head.tableId !== anchor.tableId || head.id === anchor.id) return;
    const selection = cellSelectionFromIds(anchor.id, head.id, this.editor.positions);
    if (!selection) return;
    event.preventDefault();
    this.editor.setSelection(selection, { source: "api" });
    this.renderer.render(this.editor.document, selection);
  };
  private clickListener = (event: Event) => {
    const checkControl = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`[${SMART_UI_ATTRIBUTE}="check-control"]`)
      : null;
    if (checkControl) {
      event.preventDefault();
      const itemElement = checkControl.closest<HTMLElement>('[data-smart-type="list_item"]');
      const mapped = itemElement ? this.renderer.mapping.domToNode(itemElement) : null;
      if (!mapped || isTextNode(mapped.node) || mapped.node.type !== "list_item") return;
      const itemPosition = this.editor.positions.positionOf(mapped.nodeId);
      const list = itemPosition?.parent;
      if (!itemPosition || !list || list.type !== "list" || list.attrs?.checkable !== true) return;
      const ownerId = firstEditableOwnerId(mapped.node, this.editor.schema);
      const content = ownerId ? this.editor.positions.contentRangeOf(ownerId) : null;
      if (!content) return;
      const point = content.from;
      const scope = this.editor.resolveScope({ want: "list-selection" }, { type: "text", anchor: point, head: point });
      if (!("kind" in scope) || (scope.kind !== "list-selection" && scope.kind !== "mixed")) return;
      const operations = setListChecked(this.editor.document, scope, { checked: mapped.node.attrs?.checked !== true }, this.commandContext());
      if (!operations.length) return;
      const selection = this.editor.selection;
      this.editor.transact((builder) => {
        builder.operations.push(...operations);
        builder.setSelection(selection);
      }, { source: "input", addToHistory: true });
      this.renderer.render(this.editor.document, this.editor.selection);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-smart-atomic]") : null;
    const mapped = target ? this.renderer.mapping.domToNode(target) : null;
    if (!mapped || isTextNode(mapped.node) || this.editor.schema.nodes[mapped.node.type]?.selectable !== true) return;
    const range = this.editor.positions.rangeOf(mapped.nodeId);
    if (!range) return;
    this.editor.setSelection({ type: "node", anchor: range.from, head: range.to }, { source: "api" });
    this.renderer.render(this.editor.document, this.editor.selection);
  };
  private selectionChangeListener = () => this.syncSelectionFromDom();
  private pasteListener = (event: Event) => this.handlePaste(event as ClipboardEvent);
  private copyListener = (event: Event) => this.handleCopy(event as ClipboardEvent);
  private cutListener = (event: Event) => this.handleCut(event as ClipboardEvent);
  private dragStartListener = (event: Event) => this.handleDragStart(event as DragEvent);
  private dropListener = (event: Event) => this.handleDrop(event as DragEvent);

  private cellFromNode(input: EventTarget | Node | null): { id: string; tableId: string } | null {
    const node = input instanceof Node ? input : null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const cell = element?.closest<HTMLElement>('[data-smart-type="table_cell"]');
    if (!cell) return null;
    const table = cell.closest<HTMLElement>('[data-smart-type="table"]');
    const mappedCell = this.renderer.mapping.domToNode(cell);
    const mappedTable = table ? this.renderer.mapping.domToNode(table) : null;
    if (!mappedCell || isTextNode(mappedCell.node) || !mappedTable || isTextNode(mappedTable.node)) return null;
    return { id: mappedCell.nodeId, tableId: mappedTable.nodeId };
  }

  private payloadFromTransfer(transfer: DataTransfer): RawClipboardPayload {
    const representations = Object.fromEntries(Array.from(transfer.types).filter((type) => type !== "Files").map((type) => [type, transfer.getData(type)]));
    return {
      html: representations["text/html"], plainText: representations["text/plain"],
      native: representations["application/x-smart-rte+json"], types: Array.from(transfer.types), representations,
    };
  }

  private writeTransfer(transfer: DataTransfer, document: SmartDocument): void {
    const representations = serializeClipboardRepresentations(document);
    Object.entries(representations).forEach(([type, value]) => transfer.setData(type, value));
  }

  private selectionForPoint(event: DragEvent): SmartSelection {
    const pointDocument = this.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const caret = pointDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallback = !caret ? pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY) : null;
    const pos = caret ? this.renderer.mapping.domToPos(caret.offsetNode, caret.offset)
      : fallback ? this.renderer.mapping.domToPos(fallback.startContainer, fallback.startOffset) : null;
    const target = pos || this.editor.selection.head;
    return { type: "text", anchor: target, head: target };
  }

  private commitClipboard(result: ClipboardInsertionResult, source: "paste" | "cut" | "drop"): void {
    if (!result.operations.length) return;
    const preview = applyOperations(this.editor.document, result.operations);
    const lookup = createScopeIndex().positions(preview, this.editor.schema);
    const content = lookup.contentRangeOf(result.selectionTarget.ownerId);
    const position = lookup.positionOf(result.selectionTarget.ownerId);
    const base = content?.from || position?.pos || this.editor.selection.head;
    const target = content && content.from.path.length === content.to.path.length
      && content.from.path.every((part, index) => part === content.to.path[index])
      ? { path: [...content.from.path], offset: Math.min(result.selectionTarget.offset, content.to.offset) }
      : { path: [...base.path], offset: base.offset };
    this.editor.transact((builder) => {
      builder.operations.push(...result.operations);
      builder.setSelection({ type: "text", anchor: target, head: target });
    }, { source, addToHistory: true });
    this.renderer.render(this.editor.document, this.editor.selection);
  }

  handleCopy(event: ClipboardEvent): void {
    if (!event.clipboardData || collapsed(this.editor.selection)) return;
    event.preventDefault();
    this.writeTransfer(event.clipboardData, sliceClipboardSelection(this.editor.document, this.editor.selection));
  }

  handleCut(event: ClipboardEvent): void {
    if (!event.clipboardData || collapsed(this.editor.selection)) return;
    event.preventDefault();
    this.writeTransfer(event.clipboardData, sliceClipboardSelection(this.editor.document, this.editor.selection));
    const deletion = deleteClipboardSelection(this.editor.document, this.editor.selection, this.editor.positions);
    this.commitClipboard({ ...deletion, definingAncestorId: null }, "cut");
  }

  handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (!event.clipboardData) {
      this.unhandled.push("paste-without-clipboard-data");
      return;
    }
    const payload = this.payloadFromTransfer(event.clipboardData);
    try {
      const parsed = parseClipboardPayload(payload, { ownerDocument: this.ownerDocument });
      this.options.onClipboardDiagnostic?.(reportParsedClipboard(payload, parsed));
      const fragment = remintClipboardFragmentIds(parsed.document, createNodeId);
      const result = insertClipboardFragment(this.editor.document, this.editor.selection, fragment, {
        schema: this.editor.schema, positions: this.editor.positions, idFactory: createNodeId,
      });
      this.commitClipboard(result, "paste");
    } catch (error) {
      this.options.onClipboardDiagnostic?.(reportRejectedClipboard(payload, error));
      this.unhandled.push("paste-rejected");
    }
  }

  private handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer || collapsed(this.editor.selection)) return;
    const fragment = sliceClipboardSelection(this.editor.document, this.editor.selection);
    this.internalDrag = { selection: this.editor.selection, fragment };
    this.writeTransfer(event.dataTransfer, fragment);
    event.dataTransfer.effectAllowed = "move";
  }

  handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (!event.dataTransfer) {
      this.unhandled.push("drop-without-data-transfer");
      return;
    }
    const targetSelection = this.selectionForPoint(event);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      this.options.onFiles?.(files, targetSelection);
      return;
    }
    if (this.internalDrag) {
      const deletion = deleteClipboardSelection(this.editor.document, this.internalDrag.selection, this.editor.positions);
      const preview = applyOperations(this.editor.document, deletion.operations);
      const mappedSelection = new FoundationTransactionMap(deletion.operations).mapSelection(targetSelection);
      const lookup = createScopeIndex().positions(preview, this.editor.schema);
      if (this.internalDrag.selection.type === "node" && this.internalDrag.fragment.children.length === 1) {
        const moving = this.internalDrag.fragment.children[0];
        const targetOwner = nodeAtPath(preview, mappedSelection.head.path);
        if (targetOwner && !isTextNode(targetOwner) && mappedSelection.head.path.length) {
          const parentPath = mappedSelection.head.path.slice(0, -1);
          const ownerIndex = mappedSelection.head.path[mappedSelection.head.path.length - 1];
          const insertionOffset = ownerIndex + (mappedSelection.head.offset > 0 ? 1 : 0);
          this.internalDrag = null;
          this.commitClipboard({
            operations: [...deletion.operations, { type: "insertNode", pos: { path: parentPath, offset: insertionOffset }, node: moving }],
            selectionTarget: { ownerId: isTextNode(moving) ? targetOwner.id : moving.id, offset: 0 },
            definingAncestorId: null,
          }, "drop");
          return;
        }
      }
      const insertion = insertClipboardFragment(preview, mappedSelection, this.internalDrag.fragment, {
        schema: this.editor.schema, positions: lookup, idFactory: createNodeId,
      });
      this.internalDrag = null;
      this.commitClipboard({ ...insertion, operations: [...deletion.operations, ...insertion.operations] }, "drop");
      return;
    }
    const parsed = parseClipboardPayload(this.payloadFromTransfer(event.dataTransfer), { ownerDocument: this.ownerDocument });
    const fragment = remintClipboardFragmentIds(parsed.document, createNodeId);
    const result = insertClipboardFragment(this.editor.document, targetSelection, fragment, {
      schema: this.editor.schema, positions: this.editor.positions, idFactory: createNodeId,
    });
    this.commitClipboard(result, "drop");
  }

  private commit(builderFn: (builder: TransactionBuilder) => SmartSelection, options: { compositionId?: string } = {}): void {
    this.editor.transact((builder) => builder.setSelection(builderFn(builder)), {
      source: "input",
      addToHistory: true,
      ...(options.compositionId ? { compositionId: options.compositionId } : {}),
    });
    this.renderer.render(this.editor.document, this.editor.selection);
  }

  private commandContext(): CommandContext {
    return { schema: this.editor.schema, positions: this.editor.positions };
  }

  private commitStructuralResult(
    result: ListInputResult | CodeBlockInputResult,
    source: "input" | "keyboard" = "input",
  ): void {
    if (!result.operations.length) return;
    const preview = applyOperations(this.editor.document, result.operations);
    const lookup = createScopeIndex().positions(preview, this.editor.schema);
    const content = lookup.contentRangeOf(result.selectionTarget.ownerId);
    if (!content) throw new Error(`List input selection owner "${result.selectionTarget.ownerId}" was not preserved.`);
    const target = { path: [...content.from.path], offset: result.selectionTarget.offset };
    this.editor.transact((builder) => {
      builder.operations.push(...result.operations);
      builder.setSelection({ type: "text", anchor: target, head: target });
    }, { source, addToHistory: true });
    this.renderer.render(this.editor.document, this.editor.selection);
  }

  private replaceSelection(text: string): void {
    const selection = this.editor.selection;
    this.commit((builder) => {
      const caret = collapsed(selection) ? selection.head : queueRangeDeletion(this.editor, builder, normalizedRange(selection));
      const marks = this.editor.storedMarks || marksAtInsertion(this.editor.document, caret, this.editor.schema);
      if (text) builder.operations.push({ type: "insertText", pos: caret, text, ...(marks.length ? { marks: [...marks] } : {}) });
      const next = { path: [...caret.path], offset: caret.offset + text.length };
      return { type: "text", anchor: next, head: next };
    });
  }

  private deleteRange(range: SmartRange): void {
    if (samePos(range.from, range.to)) return;
    this.commit((builder) => {
      if (isWholeDocumentRange(this.editor, range)) {
        const caret = queueWholeDocumentDeletion(this.editor, builder);
        return { type: "text", anchor: caret, head: caret };
      }
      // A node/cell selection, or a text selection crossing structural
      // parents, is not an inline range. Resolve its semantic scope and remove
      // the selected IDs; otherwise queueRangeDeletion would either silently
      // do nothing (node selection) or throw on a legitimate nested list.
      const structural = (this.editor.selection.type !== "text"
        || !samePath(range.from.path, range.to.path))
        ? structuralDeletionPlan(this.editor, this.editor.selection, range)
        : null;
      if (structural) {
        builder.operations.push(...structural.operations);
        const preview = applyOperations(this.editor.document, structural.operations);
        const lookup = createScopeIndex().positions(preview, this.editor.schema);
        const ownerId = structural.preferredOwnerIds.find((id) => lookup.exists(id))
          || firstEditableOwnerId(preview, this.editor.schema);
        const content = ownerId ? lookup.contentRangeOf(ownerId) : null;
        const caret = content?.from || { path: [], offset: 0 };
        return { type: "text", anchor: caret, head: caret };
      }
      const caret = queueRangeDeletion(this.editor, builder, range);
      return { type: "text", anchor: caret, head: caret };
    });
  }

  /**
   * Block atoms have no legal internal caret. When the browser reports a
   * structural boundary beside one (including a node selection's head), move
   * to the nearest editable block instead of manufacturing a position inside
   * the atom. If the atom is at a container edge, create the empty paragraph
   * that gives the user a real line to continue typing on.
   */
  private moveFromStructuralBoundary(path: readonly number[], offset: number, direction: -1 | 1): boolean {
    const parent = nodeAtPath(this.editor.document, path);
    if (!parent || isTextNode(parent) || isInlineOwnerNode(parent, this.editor.schema)) return false;
    const children = parent.children || [];
    let cursor = direction < 0 ? offset - 1 : offset;
    while (cursor >= 0 && cursor < children.length) {
      const child = children[cursor];
      if (!isTextNode(child) && this.editor.schema.nodes[child.type]?.atomic === true) {
        cursor += direction;
        continue;
      }
      const target = editableOwnerPosition(child, [...path, cursor], direction, this.editor.schema);
      if (target) {
        const model: SmartSelection = { type: "text", anchor: target, head: target };
        this.editor.setSelection(model, { source: "keyboard" });
        this.renderer.render(this.editor.document, model);
        return true;
      }
      cursor += direction;
    }

    // Only containers whose schema accepts blocks may receive the fallback
    // paragraph. This keeps the operation valid inside a document, list item,
    // quote, or table cell while refusing to put content inside an atom.
    const content = this.editor.schema.nodes[parent.type]?.content || "";
    if (parent.type !== "doc" && !/(?:^|[|(\s])block(?:[+*?]|$)/.test(content)) return false;
    const insertionIndex = direction > 0
      ? Math.max(0, Math.min(children.length, cursor))
      : Math.max(0, Math.min(children.length, cursor + 1));
    const paragraph: SmartElementNode = { type: "paragraph", id: createNodeId(), children: [] };
    const target: SmartPos = { path: [...path, insertionIndex], offset: 0 };
    this.editor.transact((builder) => {
      builder.operations.push({ type: "insertNode", pos: { path: [...path], offset: insertionIndex }, node: paragraph });
      builder.setSelection({ type: "text", anchor: target, head: target });
    }, { source: "keyboard", addToHistory: true });
    this.renderer.render(this.editor.document, this.editor.selection);
    return true;
  }

  private insertParagraph(): void {
    const selection = this.editor.selection;
    if (collapsed(selection)) {
      const listResult = enterInList(this.editor.document, selection.head, {
        itemId: createNodeId(), blockId: createNodeId(), emptyBlockId: createNodeId(), splitListId: createNodeId(),
      }, this.commandContext());
      if (listResult) return this.commitStructuralResult(listResult);
      const codeResult = insertCodeBlockNewline(this.editor.document, selection.head, {
        exitOnTrailingEmptyLine: true,
        paragraphId: createNodeId(),
      });
      if (codeResult) return this.commitStructuralResult(codeResult);
    }
    this.commit((builder) => {
      const caret = collapsed(selection) ? selection.head : queueRangeDeletion(this.editor, builder, normalizedRange(selection));
      const owner = ownerAt(this.editor, caret);
      const parentPath = caret.path.slice(0, -1);
      const index = caret.path[caret.path.length - 1];
      const text = inlineText(owner);
      const tail = text.slice(caret.offset);
      const [, tailChildren] = splitInlineChildren(owner.children || [], caret.offset);
      const activeMarks = marksAtInsertion(this.editor.document, caret, this.editor.schema);
      queueInlineDeletion(builder, caret.path, owner, caret.offset, text.length);
      const nextNode: SmartElementNode = {
        type: owner.type,
        id: createNodeId(),
        ...(owner.attrs ? { attrs: structuredClone(owner.attrs) } : {}),
        children: tail ? tailChildren : [],
      };
      builder.operations.push({ type: "insertNode", pos: { path: parentPath, offset: index + 1 }, node: nextNode });
      const next = { path: [...parentPath, index + 1], offset: 0 };
      // An empty split still needs the marks active at the caret for the next
      // insertion.  The transaction would otherwise clear stored marks as a
      // side effect of its structural operations.
      builder.setStoredMarks(activeMarks.length ? activeMarks : undefined);
      return { type: "text", anchor: next, head: next };
    });
  }

  private insertLineBreak(): void {
    const selection = this.editor.selection;
    if (collapsed(selection)) {
      const codeResult = insertCodeBlockNewline(this.editor.document, selection.head);
      if (codeResult) return this.commitStructuralResult(codeResult);
    }
    const operations: SmartOperation[] = [];
    const builder = new TransactionBuilder(selection, this.editor.storedMarks ? [...this.editor.storedMarks] : undefined);
    const caret = collapsed(selection) ? selection.head : queueRangeDeletion(this.editor, builder, normalizedRange(selection));
    operations.push(...builder.operations);
    const preview = operations.length ? applyOperations(this.editor.document, operations) : this.editor.document;
    operations.push(...insertHardBreak(preview, caret));
    const next = { path: [...caret.path], offset: caret.offset + 1 };
    this.editor.transact((transaction) => {
      transaction.operations.push(...operations);
      transaction.setSelection({ type: "text", anchor: next, head: next });
    }, { source: "input", addToHistory: true });
    this.renderer.render(this.editor.document, this.editor.selection);
  }

  private deleteByInputType(inputType: string): void {
    const selection = this.editor.selection;
    if (!collapsed(selection)) return this.deleteRange(normalizedRange(selection));
    const owner = ownerAt(this.editor, selection.head);
    const text = inlineText(owner);
    const offset = selection.head.offset;
    if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
      const structural = inputType.endsWith("Backward")
        ? backspaceAtListItemStart(this.editor.document, selection.head, this.commandContext())
        : deleteAtListItemEnd(this.editor.document, selection.head, this.commandContext());
      if (structural) return this.commitStructuralResult(structural);
      const boundaries = inlineGraphemeBoundaries(owner.children || []);
      const target = inputType.endsWith("Backward")
        ? [...boundaries].reverse().find((boundary) => boundary < offset)
        : boundaries.find((boundary) => boundary > offset);
      if (target !== undefined) return this.deleteRange(inputType.endsWith("Backward")
        ? { from: { ...selection.head, offset: target }, to: selection.head }
        : { from: selection.head, to: { ...selection.head, offset: target } });
      return this.deleteAcrossBlock(inputType.endsWith("Backward") ? -1 : 1);
    }
    const backward = inputType.endsWith("Backward");
    const target = inputType === "deleteSoftLineBackward" ? 0 : backward ? previousWord(text, offset) : nextWord(text, offset);
    this.deleteRange(backward
      ? { from: { ...selection.head, offset: target }, to: selection.head }
      : { from: selection.head, to: { ...selection.head, offset: target } });
  }

  private deleteAcrossBlock(direction: -1 | 1): void {
    const position = this.editor.selection.head;
    const current = nodeAtPath(this.editor.document, position.path);
    if (!current || isTextNode(current) || !isInlineOwnerNode(current, this.editor.schema)) return;

    // Preserve the existing atom selection affordance for a directly adjacent
    // block atom. A block atom is selected first and deleted on the next key,
    // rather than being silently consumed by a cross-container merge.
    if (position.path.length) {
      const parentPath = position.path.slice(0, -1);
      const index = position.path[position.path.length - 1];
      const parent = nodeAtPath(this.editor.document, parentPath);
      const neighbor = parent && !isTextNode(parent) ? parent.children?.[index + direction] : undefined;
      if (neighbor && !isTextNode(neighbor) && this.editor.schema.nodes[neighbor.type]?.atomic === true) {
        const range = this.editor.positions.rangeOf(neighbor.id);
        if (range) {
          this.editor.setSelection({ type: "node", anchor: range.from, head: range.to }, { source: "keyboard" });
          this.renderer.render(this.editor.document, this.editor.selection);
        }
        return;
      }
    }

    const owners = editableOwners(this.editor.document, [], this.editor.schema);
    const currentIndex = owners.findIndex((entry) => entry.node.id === current.id);
    const adjacent = currentIndex >= 0 ? owners[currentIndex + direction] : undefined;
    if (!adjacent) return;

    const target = direction < 0
      ? resolvePrecedingContentTarget(this.editor.document, current.id, this.commandContext())
      : null;
    const targetOwner = direction < 0
      ? target && nodeAtPath(this.editor.document, this.editor.positions.contentRangeOf(target.ownerId)?.from.path || [])
      : adjacent.node;
    const targetId = direction < 0 ? target?.ownerId : adjacent.node.id;
    if (!targetOwner || isTextNode(targetOwner) || !targetId || targetOwner.id === current.id) return;

    const currentPosition = this.editor.positions.positionOf(current.id);
    const targetPosition = this.editor.positions.positionOf(targetId);
    if (!currentPosition || !targetPosition) return;

    // A blank line at a structural boundary is removed as a block, leaving
    // the caret at the nearest visible content. This is the path exercised
    // after Enter twice exits a depth-zero list. Do not merge an empty quote
    // paragraph with the outside boundary paragraph: that would re-enter the
    // quote's content instead of exiting its scope.
    if (inlineText(current) === "") {
      const targetRange = this.editor.positions.contentRangeOf(targetId);
      if (!targetRange) return;
      const targetSelection: SmartSelection = {
        type: "text",
        anchor: direction < 0 ? targetRange.to : targetRange.from,
        head: direction < 0 ? targetRange.to : targetRange.from,
      };
      const operations: SmartOperation[] = [{ type: "removeNode", pos: currentPosition.pos, node: current }];
      const mappedSelection = new FoundationTransactionMap(operations).mapSelection(targetSelection);
      this.editor.transact((builder) => {
        builder.operations.push(...operations);
        builder.setSelection(mappedSelection);
      }, { source: "input", addToHistory: true });
      this.renderer.render(this.editor.document, this.editor.selection);
      return;
    }

    if (targetOwner.type !== current.type) return;
    const targetChildren = direction < 0
      ? [...(targetOwner.children || []), ...(current.children || []).map((node) => structuredClone(node))]
      : [...(current.children || []), ...(targetOwner.children || []).map((node) => structuredClone(node))];
    // Backward deletion keeps the preceding owner; forward deletion keeps the
    // current owner.  Keeping the owner at the caret is the identity contract
    // used by ordinary cross-block deletion and prevents annotations on the
    // active block from being retired merely because its content was joined.
    const survivingOwner = direction < 0 ? targetOwner : current;
    const removedOwner = direction < 0 ? current : targetOwner;
    const survivingPosition = direction < 0 ? targetPosition : currentPosition;
    const removedPosition = direction < 0 ? currentPosition : targetPosition;
    const merged = { ...survivingOwner, children: targetChildren };
    const survivingContent = this.editor.positions.contentRangeOf(survivingOwner.id);
    if (!survivingContent) return;
    const selectionOffset = direction < 0 ? survivingContent.to.offset : inlineText(current).length;
    const targetSelection: SmartSelection = {
      type: "text",
      anchor: direction < 0
        ? { path: [...survivingContent.to.path], offset: selectionOffset }
        : { path: [...survivingContent.from.path], offset: selectionOffset },
      head: direction < 0
        ? { path: [...survivingContent.to.path], offset: selectionOffset }
        : { path: [...survivingContent.from.path], offset: selectionOffset },
    };
    const operations: SmartOperation[] = [
      { type: "replaceNode", pos: survivingPosition.pos, before: survivingOwner, after: merged },
      { type: "removeNode", pos: removedPosition.pos, node: removedOwner },
    ];
    // Forward deletion removes the current owner before the target's old
    // path. Map the selection through both operations instead of retaining a
    // stale path (the exact failure after Enter twice exits a list in a
    // quote). Backward deletion uses the same mapping for symmetry.
    const mappedSelection = new FoundationTransactionMap(operations).mapSelection(targetSelection);
    this.editor.transact((builder) => {
      builder.operations.push(...operations);
      builder.setSelection(mappedSelection);
    }, { source: "input", addToHistory: true });
    this.renderer.render(this.editor.document, this.editor.selection);
  }

  handleBeforeInput(event: InputEvent): void {
    if (this.destroyed) return;
    const type = event.inputType;
    // Browsers may dispatch beforeinput for a keyboard selection mutation
    // before the asynchronous selectionchange event reaches the document.
    // Refresh the model from the native selection first, otherwise Ctrl/Cmd+A
    // followed immediately by Backspace/Delete is mistaken for a collapsed
    // caret at the old location.
    // A canonical node selection is already the semantic selection for the
    // upcoming replacement/deletion.  The renderer projects it as a native
    // range over the node's contents, which is intentionally not a text range
    // to be re-imported here (doing so turns a selected quote/code node into a
    // paragraph selection and leaves the node behind).
    const preserveNodeSelection = this.editor.selection.type === "node"
      && (type === "deleteContentBackward" || type === "deleteContentForward"
        || type === "insertText" || type === "insertReplacementText");
    if (!this.composition && !preserveNodeSelection) this.syncSelectionFromDom();
    if (this.composition && (type === "insertCompositionText" || type === "deleteCompositionText")) return;
    if (this.editor.selection.type === "node" && (type === "insertText" || type === "insertReplacementText"
      || type === "deleteContentBackward" || type === "deleteContentForward")) {
      const scope = this.editor.resolveScope({ want: "atomic-node" });
      if ("kind" in scope && scope.kind === "atomic-node") {
        event.preventDefault();
        const resolved = this.editor.positions.positionOf(scope.nodeId);
        const node = resolved?.parent.children?.[resolved.pos.offset];
        if (!resolved || !node || isTextNode(node)) return;
        const group = this.editor.schema.nodes[node.type]?.group;
        const text = type === "insertText" || type === "insertReplacementText" ? event.data || "" : "";
        this.editor.transact((builder) => {
          if (group === "inline") {
            builder.operations.push({ type: "removeNode", pos: resolved.pos, node });
            if (text) builder.operations.push({ type: "insertText", pos: scope.range.from, text });
            const caret = { path: [...scope.range.from.path], offset: scope.range.from.offset + text.length };
            builder.setSelection({ type: "text", anchor: caret, head: caret });
          } else {
            const replacement: SmartElementNode = { type: "paragraph", id: createNodeId(), children: text ? [{ type: "text", text }] : [] };
            builder.operations.push({ type: "replaceNode", pos: resolved.pos, before: node, after: replacement });
            const caret = { path: [...resolved.pos.path, resolved.pos.offset], offset: text.length };
            builder.setSelection({ type: "text", anchor: caret, head: caret });
          }
        }, { source: "input", addToHistory: true });
        this.renderer.render(this.editor.document, this.editor.selection);
        return;
      }
    }
    if (type === "insertText" || type === "insertReplacementText") {
      event.preventDefault();
      this.replaceSelection(event.data || "");
    } else if (type === "insertParagraph") {
      event.preventDefault();
      this.insertParagraph();
    } else if (type === "insertLineBreak") {
      event.preventDefault();
      this.insertLineBreak();
    } else if (["formatBold", "formatItalic", "formatUnderline", "formatStrikeThrough"].includes(type)) {
      event.preventDefault();
      const id = type === "formatBold" ? "bold" : type === "formatItalic" ? "italic" : type === "formatUnderline" ? "underline" : "strikethrough";
      const declaration = inlineToolDeclarations.find((tool) => tool.id === id)!;
      executeMarkTool(this.editor, declaration, "toggle");
      this.renderer.render(this.editor.document, this.editor.selection);
    } else if (["deleteContentBackward", "deleteContentForward", "deleteWordBackward", "deleteWordForward", "deleteSoftLineBackward"].includes(type)) {
      event.preventDefault();
      this.deleteByInputType(type);
    } else if (type === "historyUndo" || type === "historyRedo") {
      event.preventDefault();
      if (type === "historyUndo") this.editor.undo();
      else this.editor.redo();
      this.renderer.render(this.editor.document, this.editor.selection);
    } else if (["insertFromPaste", "insertFromDrop", "deleteByCut"].includes(type)) {
      // Owned by paste/drop/cut events, which carry the actual transfer payload.
      event.preventDefault();
    } else {
      event.preventDefault();
      this.unhandled.push(type || "unknown");
      console.warn(`[Smart RTE canonical input] cancelled unsupported inputType: ${type || "unknown"}`);
    }
  }

  private moveCaret(direction: -1 | 1, word = false): void {
    const selection = this.editor.selection;
    const active = selection.head;
    const activeOwner = nodeAtPath(this.editor.document, active.path);
    if (activeOwner && !isTextNode(activeOwner) && !isInlineOwnerNode(activeOwner, this.editor.schema)) {
      if (this.moveFromStructuralBoundary(active.path, active.offset, direction)) return;
      return;
    }
    const owner = ownerAt(this.editor, active);
    const text = inlineText(owner);
    let offset = word
      ? direction < 0 ? previousWord(text, active.offset) : nextWord(text, active.offset)
      : direction < 0
        ? [...inlineGraphemeBoundaries(owner.children || [])].reverse().find((value) => value < active.offset) ?? active.offset
        : inlineGraphemeBoundaries(owner.children || []).find((value) => value > active.offset) ?? active.offset;
    let path = active.path;
    if (offset === active.offset) {
      const parentPath = active.path.slice(0, -1);
      const siblingIndex = active.path.length ? active.path[active.path.length - 1] + direction : -1;
      const parent = active.path.length ? nodeAtPath(this.editor.document, parentPath) : undefined;
      const neighbor = !parent || isTextNode(parent) ? undefined : parent.children?.[siblingIndex];
      if (neighbor && !isTextNode(neighbor)) {
        // Enter a structural sibling through its nearest editable owner. The
        // previous implementation treated the structural node itself as an
        // inline owner, which made quote/table edges unreachable and left the
        // browser selection on an address with no caret.
        const target = editableOwnerPosition(neighbor, [...parentPath, siblingIndex], direction, this.editor.schema);
        if (target) {
          path = target.path;
          offset = target.offset;
        } else if (this.moveFromStructuralBoundary(parentPath, direction > 0 ? siblingIndex : siblingIndex + 1, direction)) {
          return;
        }
      } else {
        // A quote or table may be separated from the current owner by a
        // structural ancestor. Walk logical owner order rather than only the
        // immediate sibling array, so arrows cross nested containers and the
        // editable boundary paragraphs installed by the normalizer.
        const owners = editableOwners(this.editor.document, [], this.editor.schema);
        const currentIndex = owners.findIndex((entry) => entry.path.length === active.path.length
          && entry.path.every((part, index) => part === active.path[index]));
        const adjacent = currentIndex >= 0 ? owners[currentIndex + direction] : undefined;
        if (adjacent) {
          path = adjacent.path;
          offset = direction < 0 ? inlineText(adjacent.node).length : 0;
        }
      }
    }
    const next = { path: [...path], offset };
    const model: SmartSelection = { type: "text", anchor: next, head: next };
    this.editor.setSelection(model, { source: "keyboard" });
    this.renderer.render(this.editor.document, model);
  }

  handleKeyDown(event: KeyboardEvent): void {
    // Selectionchange is delivered asynchronously in Chromium.  A keyboard
    // navigation key can therefore arrive immediately after Ctrl/Cmd+A while
    // the native range is document-wide but the canonical selection still
    // describes the previous owner.  Import the current native range before
    // directional handling so ArrowUp/Down never operates on stale paths.
    if (!this.composition && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      this.syncSelectionFromDom();
    }
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && modifier && !event.shiftKey) {
      const result = exitCodeBlock(this.editor.document, this.editor.selection.head, createNodeId());
      if (result) {
        event.preventDefault();
        this.commitStructuralResult(result, "keyboard");
        return;
      }
    }
    // WebKit does not consistently surface Shift+Enter as
    // beforeinput(insertLineBreak). Own the intent at keydown so every browser
    // produces the same atomic hard_break representation.
    if (event.key === "Enter" && event.shiftKey && !modifier) {
      event.preventDefault();
      this.insertLineBreak();
      return;
    }
    const shortcut = modifier ? ({ b: "bold", i: "italic", u: "underline" } as const)[event.key.toLowerCase() as "b" | "i" | "u"] : undefined;
    if (shortcut) {
      event.preventDefault();
      executeMarkTool(this.editor, inlineToolDeclarations.find((tool) => tool.id === shortcut)!, "toggle");
      this.renderer.render(this.editor.document, this.editor.selection);
      return;
    }
    if (modifier && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.root.dispatchEvent(new CustomEvent("smart-link-request", { bubbles: true }));
      return;
    }
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.editor.redo(); else this.editor.undo();
      this.renderer.render(this.editor.document, this.editor.selection);
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.editor.redo();
      this.renderer.render(this.editor.document, this.editor.selection);
      return;
    }
    if (event.key === "Tab") {
      const active = this.editor.selection.head;
      const codeResult = indentInsideCodeBlock(this.editor.document, active);
      if (codeResult) {
        event.preventDefault();
        this.commitStructuralResult(codeResult, "keyboard");
        return;
      }
      const item = listItemAt(this.editor.document, active);
      const description = this.editor.resolveScope({ want: "describe" });
      if (item && "inTable" in description && !description.inTable) {
        const scope = this.editor.resolveScope({ want: "list-selection" });
        if ("kind" in scope) {
          const operations = event.shiftKey
            ? outdentList(this.editor.document, scope, { splitListIds: [createNodeId()] }, this.commandContext())
            : indentList(this.editor.document, scope, { nestedListIds: [createNodeId()] }, this.commandContext());
          if (operations.length) {
            event.preventDefault();
            this.commitStructuralResult({ operations, selectionTarget: { ownerId: ownerAt(this.editor, active).id, offset: active.offset }, intent: event.shiftKey ? "outdent" : "indent" }, "keyboard");
          }
        }
        return;
      }
      // Tables own Tab navigation; the list layer deliberately yields.
      return;
    }
    // Space is ordinary text while the caret is inside a checklist item.  When
    // keyboard focus is actually on the projected checkbox button, preserve
    // native button semantics by routing Space to the same click path.  The
    // focus check is essential: a global checklist-item shortcut makes a
    // sentence such as "Buy milk" toggle the item and drops the separator.
    if ((event.key === " " || event.key === "Spacebar")
      && this.ownerDocument.activeElement instanceof Element) {
      const checkControl = this.ownerDocument.activeElement.closest<HTMLElement>(`[${SMART_UI_ATTRIBUTE}="check-control"]`);
      if (checkControl) {
        event.preventDefault();
        checkControl.click();
        return;
      }
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      // Plain arrows collapse a range to its normalized endpoint.  Reading
      // `selection.head` here makes the result depend on drag direction,
      // violating the anchor/head contract and reversing Left/Right for a
      // bottom-to-top selection.
      if (!event.shiftKey && this.editor.selection.type === "text" && !collapsed(this.editor.selection)) {
        const range = normalizedRange(this.editor.selection);
        const target = direction < 0 ? range.from : range.to;
        const model: SmartSelection = { type: "text", anchor: target, head: target };
        this.editor.setSelection(model, { source: "keyboard" });
        this.renderer.render(this.editor.document, model);
        return;
      }
      this.moveCaret(direction, modifier || event.altKey);
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && this.editor.selection.type === "node") {
      // Native vertical movement has no useful target while a block atom is
      // selected. Treat it as movement to the preceding/following editable
      // line, matching left/right atom-boundary navigation.
      event.preventDefault();
      this.moveCaret(event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const active = this.editor.selection.head;
      const owner = ownerAt(this.editor, active);
      const next = { path: [...active.path], offset: event.key === "Home" ? 0 : inlineText(owner).length };
      const model: SmartSelection = { type: "text", anchor: next, head: next };
      this.editor.setSelection(model, { source: "keyboard" });
      this.renderer.render(this.editor.document, model);
    }
  }

  handleCompositionStart(_event: CompositionEvent): void {
    const selection = this.editor.selection;
    const owner = ownerAt(this.editor, selection.head);
    const element = this.renderer.mapping.nodeToDom(owner.id);
    const observer = element && typeof MutationObserver !== "undefined" ? new MutationObserver(() => undefined) : null;
    observer?.observe(element as Node, { subtree: true, childList: true, characterData: true });
    this.composition = {
      id: createNodeId(), ownerId: owner.id, ownerPath: [...selection.head.path], beforeText: inlineText(owner), selectionBefore: selection, observer,
      beforeTokens: tokenizeCompositionOwner(owner),
      activeMarks: [...(this.editor.storedMarks || marksAtInsertion(this.editor.document, selection.head, this.editor.schema))],
    };
    this.renderer.beginComposition(owner.id);
  }

  /** DOM remains authoritative; updates are intentionally observed, not rendered. */
  handleCompositionUpdate(_event: CompositionEvent): void {}

  handleCompositionEnd(_event: CompositionEvent): void {
    const state = this.composition;
    if (!state) return;
    state.observer?.disconnect();
    const element = this.renderer.mapping.nodeToDom(state.ownerId);
    const afterTokens: CompositionToken[] = [];
    if (element) {
      [...element.childNodes].forEach((direct) => {
        const directElement = direct instanceof HTMLElement ? direct : direct.parentElement;
        if (directElement?.closest("[data-smart-ui]")) return;
        const atomic = directElement?.closest<HTMLElement>("[data-smart-atomic]");
        if (atomic) {
          const mapped = this.renderer.mapping.domToNode(atomic);
          if (mapped && !isTextNode(mapped.node)) afterTokens.push({ kind: "atom", nodeId: mapped.node.id, atomType: mapped.node.type });
          return;
        }
        const text = direct.textContent || "";
        if (!text) return;
        const marks: SmartMark[] = [];
        const walker = element.ownerDocument.createTreeWalker(direct, NodeFilter.SHOW_TEXT);
        const firstText = direct.nodeType === direct.TEXT_NODE ? direct : walker.nextNode();
        let cursor = firstText?.parentElement || null;
        while (cursor && cursor !== element) {
          const type = cursor.getAttribute("data-smart-mark");
          if (type) {
            const raw = cursor.getAttribute("data-smart-mark-attrs");
            marks.push({ type, ...(raw ? { attrs: JSON.parse(raw) as Record<string, unknown> } : {}) });
          }
          cursor = cursor.parentElement;
        }
        afterTokens.push({ kind: "text", text, marks: canonicalMarkOrder(marks) });
      });
    }
    const beforeUnits = tokenUnits(state.beforeTokens);
    const afterUnits = tokenUnits(afterTokens);
    let prefix = 0;
    while (prefix < beforeUnits.length && prefix < afterUnits.length
      && beforeUnits[prefix].char === afterUnits[prefix].char && beforeUnits[prefix].key === afterUnits[prefix].key) prefix += 1;
    let suffix = 0;
    while (suffix < beforeUnits.length - prefix && suffix < afterUnits.length - prefix
      && beforeUnits[beforeUnits.length - 1 - suffix].char === afterUnits[afterUnits.length - 1 - suffix].char
      && beforeUnits[beforeUnits.length - 1 - suffix].key === afterUnits[afterUnits.length - 1 - suffix].key) suffix += 1;
    const removed = beforeUnits.slice(prefix, beforeUnits.length - suffix);
    const inserted = afterUnits.slice(prefix, afterUnits.length - suffix);
    const domSelection = this.ownerDocument.getSelection();
    const domCaret = domSelection?.focusNode ? this.renderer.mapping.domToPos(domSelection.focusNode, domSelection.focusOffset) : null;
    this.renderer.endComposition();
    this.composition = null;
    // Atoms are opaque composition boundaries. If a browser mutation crosses,
    // reject the DOM mutation and restore the unchanged canonical owner.
    if (removed.some((unit) => unit.kind === "atom") || inserted.some((unit) => unit.kind === "atom")) {
      return this.renderer.render(this.editor.document, this.editor.selection);
    }
    if (!removed.length && !inserted.length) return this.renderer.render(this.editor.document, this.editor.selection);
    this.commit((builder) => {
      if (removed.length) queueInlineDeletion(builder, state.ownerPath, ownerAt(this.editor, { path: state.ownerPath, offset: prefix }), prefix, prefix + removed.length);
      let insertedOffset = 0;
      while (insertedOffset < inserted.length) {
        const key = inserted[insertedOffset].key;
        let end = insertedOffset + 1;
        while (end < inserted.length && inserted[end].key === key) end += 1;
        const text = inserted.slice(insertedOffset, end).map((unit) => unit.char).join("");
        const marks = inserted[insertedOffset].marks.length ? inserted[insertedOffset].marks : state.activeMarks;
        builder.operations.push({ type: "insertText", pos: { path: state.ownerPath, offset: prefix + insertedOffset }, text, ...(marks.length ? { marks } : {}) });
        insertedOffset = end;
      }
      const caret = domCaret || { path: state.ownerPath, offset: prefix + inserted.length };
      return { type: "text", anchor: caret, head: caret };
    }, { compositionId: state.id });
  }

  syncSelectionFromDom(): void {
    if (this.destroyed || this.composition) return;
    const native = this.ownerDocument.getSelection();
    if (!native?.anchorNode || !native.focusNode || !this.root.contains(native.anchorNode) || !this.root.contains(native.focusNode)) return;
    const anchor = this.renderer.mapping.domToPos(native.anchorNode, native.anchorOffset);
    const head = this.renderer.mapping.domToPos(native.focusNode, native.focusOffset);
    if (!anchor || !head) return;
    // A selectable atom is projected as a native range spanning its parent
    // boundary.  The browser emits `selectionchange` after that projection,
    // and importing the range as a text selection would immediately discard
    // the semantic node selection that the atom click established.  Preserve
    // it only when the native endpoints are exactly the node range; a
    // genuinely different native range must still replace the node selection.
    const current = this.editor.selection;
    if (current.type === "node") {
      const currentRange = normalizedRange(current);
      if (samePos(anchor, currentRange.from) && samePos(head, currentRange.to)) return;
      if (samePos(anchor, currentRange.to) && samePos(head, currentRange.from)) return;
    }
    // A cell selection is projected as a native range spanning the selected
    // cell boundaries.  The browser emits `selectionchange` for that
    // projection; importing the endpoints as a text selection would lose the
    // semantic cell selection (and, after a merge, make the result depend on
    // which render frame happened to win). Preserve it while the native range
    // still represents the same model endpoints. A genuinely different click
    // or drag maps to a new selection below.
    if (current.type === "cell") {
      if (samePos(anchor, current.anchor) && samePos(head, current.head)) return;
      if (samePos(anchor, current.head) && samePos(head, current.anchor)) return;
    }
    // A native selection may collapse on the editable root (or another
    // structural container) instead of an inline owner. Keep that DOM detail
    // out of canonical state: root offset `children.length`, in particular,
    // is the browser's representation of "below the final blockquote" and
    // would otherwise leave ownerAt() with an unusable document path.
    const collapsedNative = native.isCollapsed;
    const normalizedAnchor = editablePositionForStructuralBoundary(
      this.editor,
      anchor,
      collapsedNative ? (anchor.offset === 0 ? 1 : -1) : 1,
    ) || anchor;
    const normalizedHead = editablePositionForStructuralBoundary(
      this.editor,
      head,
      collapsedNative ? (head.offset === 0 ? 1 : -1) : -1,
    ) || head;
    let model: SmartSelection = { type: "text", anchor: normalizedAnchor, head: normalizedHead };
    const anchorCell = this.cellFromNode(native.anchorNode);
    const headCell = this.cellFromNode(native.focusNode);
    if (anchorCell && headCell && anchorCell.tableId === headCell.tableId && anchorCell.id !== headCell.id) {
      const cellSelection = cellSelectionFromIds(anchorCell.id, headCell.id, this.editor.positions);
      if (cellSelection) model = cellSelection;
    }
    const description = this.editor.resolveScope({ want: "describe" }, model);
    if (model.type !== "cell" && "spansIsolatingBoundary" in description && description.spansIsolatingBoundary) {
      const isolateId = description.inTable?.tableId || description.isolatingAncestorId;
      const range = isolateId ? this.editor.positions.rangeOf(isolateId) : null;
      if (range) model = { type: "node", anchor: range.from, head: range.to };
    }
    if (current.type === model.type && samePos(current.anchor, model.anchor) && samePos(current.head, model.head)) return;
    this.editor.setSelection(model, { source: "api" });
    // Re-project a normalized structural DOM point immediately. Without this
    // call the model would know the right owner while the browser caret stayed
    // on the root boundary, making the first subsequent input appear inert.
    this.renderer.render(this.editor.document, model);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.composition?.observer?.disconnect();
    this.root.removeEventListener("beforeinput", this.beforeInputListener);
    this.root.removeEventListener("keydown", this.keyDownListener);
    this.root.removeEventListener("compositionstart", this.compositionStartListener);
    this.root.removeEventListener("compositionupdate", this.compositionUpdateListener);
    this.root.removeEventListener("compositionend", this.compositionEndListener);
    this.root.removeEventListener("click", this.clickListener);
    this.root.removeEventListener("mousedown", this.tableMouseDownListener);
    this.root.removeEventListener("mouseup", this.tableMouseUpListener);
    this.ownerDocument.removeEventListener("selectionchange", this.selectionChangeListener);
    this.root.removeEventListener("paste", this.pasteListener);
    this.root.removeEventListener("copy", this.copyListener);
    this.root.removeEventListener("cut", this.cutListener);
    this.root.removeEventListener("dragstart", this.dragStartListener);
    this.root.removeEventListener("drop", this.dropListener);
  }
}

export const createInputPipeline = (
  editor: FoundationEditor,
  renderer: CanonicalSubtreeRenderer,
  root: HTMLElement,
  options: CanonicalInputPipelineOptions = {},
): CanonicalInputPipeline => new FoundationInputPipeline(editor, renderer, root, options);
