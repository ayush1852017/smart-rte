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
import type { SmartElementNode, SmartNode, SmartOperation, SmartPos, SmartRange, SmartSelection } from "../types.js";
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

interface CompositionToken { text: string; marks: SmartMark[] }

const samePos = (left: SmartPos, right: SmartPos) => comparePos(left, right) === 0;
const normalizedRange = (selection: SmartSelection): SmartRange => comparePos(selection.anchor, selection.head) <= 0
  ? { from: selection.anchor, to: selection.head }
  : { from: selection.head, to: selection.anchor };
const collapsed = (selection: SmartSelection) => samePos(selection.anchor, selection.head);
const inlineText = (owner: SmartElementNode) => (owner.children || []).map((node) => isTextNode(node) ? node.text : "\uFFFC").join("");
const modelCompositionTokens = (owner: SmartElementNode): CompositionToken[] => (owner.children || [])
  .filter(isTextNode).map((node) => ({ text: node.text, marks: [...(node.marks || [])] }));
const tokenUnits = (tokens: readonly CompositionToken[]) => tokens.flatMap((token) =>
  Array.from({ length: token.text.length }, (_, index) => ({ char: token.text[index], marks: token.marks, key: token.marks.map(markKey).join("|") })));

const ownerAt = (editor: FoundationEditor, pos: SmartPos): SmartElementNode => {
  const node = nodeAtPath(editor.document, pos.path);
  if (!node || isTextNode(node)) throw new Error("Input position must resolve to an inline owner.");
  return node;
};

const textSegments = (owner: SmartElementNode) => {
  let offset = 0;
  return (owner.children || []).map((node, index) => {
    const from = offset;
    offset += isTextNode(node) ? node.text.length : 1;
    return { node, index, from, to: offset };
  });
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

  constructor(
    readonly editor: FoundationEditor,
    readonly renderer: CanonicalSubtreeRenderer,
    private readonly root: HTMLElement,
  ) {
    this.ownerDocument = root.ownerDocument;
    root.addEventListener("beforeinput", this.beforeInputListener);
    root.addEventListener("keydown", this.keyDownListener);
    root.addEventListener("compositionstart", this.compositionStartListener);
    root.addEventListener("compositionupdate", this.compositionUpdateListener);
    root.addEventListener("compositionend", this.compositionEndListener);
    this.ownerDocument.addEventListener("selectionchange", this.selectionChangeListener);
    root.addEventListener("paste", this.cancelClipboard);
    root.addEventListener("drop", this.cancelClipboard);
    renderer.render(editor.document, editor.selection);
    editor.resolveScope({ want: "describe" });
  }

  get unhandledInputTypes(): readonly string[] { return this.unhandled; }

  private beforeInputListener = (event: Event) => this.handleBeforeInput(event as InputEvent);
  private keyDownListener = (event: Event) => this.handleKeyDown(event as KeyboardEvent);
  private compositionStartListener = (event: Event) => this.handleCompositionStart(event as CompositionEvent);
  private compositionUpdateListener = (event: Event) => this.handleCompositionUpdate(event as CompositionEvent);
  private compositionEndListener = (event: Event) => this.handleCompositionEnd(event as CompositionEvent);
  private selectionChangeListener = () => this.syncSelectionFromDom();
  private cancelClipboard = (event: Event) => {
    event.preventDefault();
    this.unhandled.push(event.type);
  };

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
      const caret = queueRangeDeletion(this.editor, builder, range);
      return { type: "text", anchor: caret, head: caret };
    });
  }

  private insertParagraph(): void {
    const selection = this.editor.selection;
    if (collapsed(selection)) {
      const listResult = enterInList(this.editor.document, selection.head, {
        itemId: createNodeId(), blockId: createNodeId(), emptyBlockId: createNodeId(),
      }, this.commandContext());
      if (listResult) return this.commitStructuralResult(listResult);
      const codeResult = insertCodeBlockNewline(this.editor.document, selection.head);
      if (codeResult) return this.commitStructuralResult(codeResult);
    }
    this.commit((builder) => {
      const caret = collapsed(selection) ? selection.head : queueRangeDeletion(this.editor, builder, normalizedRange(selection));
      const owner = ownerAt(this.editor, caret);
      const parentPath = caret.path.slice(0, -1);
      const index = caret.path[caret.path.length - 1];
      const text = inlineText(owner);
      const tail = text.slice(caret.offset);
      queueInlineDeletion(builder, caret.path, owner, caret.offset, text.length);
      const nextNode: SmartElementNode = { type: owner.type, id: createNodeId(), ...(owner.attrs ? { attrs: owner.attrs } : {}), children: tail ? [{ type: "text", text: tail }] : [] };
      builder.operations.push({ type: "insertNode", pos: { path: parentPath, offset: index + 1 }, node: nextNode });
      const next = { path: [...parentPath, index + 1], offset: 0 };
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
    if (!position.path.length) return;
    const parentPath = position.path.slice(0, -1);
    const index = position.path[position.path.length - 1];
    const parent = nodeAtPath(this.editor.document, parentPath);
    if (!parent || isTextNode(parent) || !parent.children) return;
    const neighborIndex = index + direction;
    const neighbor = parent.children[neighborIndex];
    if (!neighbor || isTextNode(neighbor)) return;
    const neighborSize = inlineText(neighbor).length;
    const range = direction < 0
      ? { from: { path: [...parentPath, neighborIndex], offset: neighborSize }, to: position }
      : { from: position, to: { path: [...parentPath, neighborIndex], offset: 0 } };
    this.deleteRange(range);
  }

  handleBeforeInput(event: InputEvent): void {
    if (this.destroyed) return;
    const type = event.inputType;
    if (this.composition && (type === "insertCompositionText" || type === "deleteCompositionText")) return;
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
    } else {
      event.preventDefault();
      this.unhandled.push(type || "unknown");
      console.warn(`[Smart RTE canonical input] cancelled unsupported inputType: ${type || "unknown"}`);
    }
  }

  private moveCaret(direction: -1 | 1, word = false): void {
    const selection = this.editor.selection;
    const active = selection.head;
    const owner = ownerAt(this.editor, active);
    const text = inlineText(owner);
    let offset = word
      ? direction < 0 ? previousWord(text, active.offset) : nextWord(text, active.offset)
      : direction < 0
        ? [...inlineGraphemeBoundaries(owner.children || [])].reverse().find((value) => value < active.offset) ?? active.offset
        : inlineGraphemeBoundaries(owner.children || []).find((value) => value > active.offset) ?? active.offset;
    let path = active.path;
    if (offset === active.offset && active.path.length) {
      const parentPath = active.path.slice(0, -1);
      const index = active.path[active.path.length - 1] + direction;
      const parent = nodeAtPath(this.editor.document, parentPath);
      const neighbor = !parent || isTextNode(parent) ? undefined : parent.children?.[index];
      if (neighbor && !isTextNode(neighbor)) {
        path = [...parentPath, index];
        offset = direction < 0 ? inlineText(neighbor).length : 0;
      }
    }
    const next = { path: [...path], offset };
    const model: SmartSelection = { type: "text", anchor: next, head: next };
    this.editor.setSelection(model, { source: "keyboard" });
    this.renderer.render(this.editor.document, model);
  }

  handleKeyDown(event: KeyboardEvent): void {
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
    if (event.key === " " || event.key === "Spacebar") {
      const active = this.editor.selection.head;
      const item = listItemAt(this.editor.document, active);
      if (item) {
        const itemPosition = this.editor.positions.positionOf(item.itemId);
        const itemNode = itemPosition?.parent.children?.[itemPosition.pos.offset];
        const listNode = itemPosition?.parent;
        if (itemNode && !isTextNode(itemNode) && listNode?.type === "list" && listNode.attrs?.checkable === true) {
          const scope = this.editor.resolveScope({ want: "list-selection" });
          if ("kind" in scope) {
            const operations = setListChecked(this.editor.document, scope, { checked: itemNode.attrs?.checked !== true }, this.commandContext());
            if (operations.length) {
              event.preventDefault();
              this.commitStructuralResult({ operations, selectionTarget: { ownerId: ownerAt(this.editor, active).id, offset: active.offset }, intent: "check" }, "keyboard");
              return;
            }
          }
        }
      }
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.moveCaret(event.key === "ArrowLeft" ? -1 : 1, modifier || event.altKey);
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
      beforeTokens: modelCompositionTokens(owner),
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
        if (directElement?.closest("[data-smart-ui],[data-smart-atomic]")) return;
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
        afterTokens.push({ text, marks: canonicalMarkOrder(marks) });
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
    let model: SmartSelection = { type: "text", anchor, head };
    const description = this.editor.resolveScope({ want: "describe" }, model);
    if ("spansIsolatingBoundary" in description && description.spansIsolatingBoundary) {
      const isolateId = description.inTable?.tableId || description.isolatingAncestorId;
      const range = isolateId ? this.editor.positions.rangeOf(isolateId) : null;
      if (range) model = { type: "node", anchor: range.from, head: range.to };
    }
    const current = this.editor.selection;
    if (current.type === model.type && samePos(current.anchor, model.anchor) && samePos(current.head, model.head)) return;
    this.editor.setSelection(model, { source: "api" });
    if (model.type === "node") this.renderer.render(this.editor.document, model);
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
    this.ownerDocument.removeEventListener("selectionchange", this.selectionChangeListener);
    this.root.removeEventListener("paste", this.cancelClipboard);
    this.root.removeEventListener("drop", this.cancelClipboard);
  }
}

export const createInputPipeline = (
  editor: FoundationEditor,
  renderer: CanonicalSubtreeRenderer,
  root: HTMLElement,
): CanonicalInputPipeline => new FoundationInputPipeline(editor, renderer, root);
