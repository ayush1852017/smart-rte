import { createNodeId, isTextNode } from "./identity.js";
import { popRedo, popUndo, recordHistory, createHistory, rebaseHistoryNodeAttributes } from "./history.js";
import { runNormalization, type NormalizationRun } from "./normalization.js";
import { applyOperations } from "./operations.js";
import { resolvePos } from "./positions.js";
import { foundationSchema, repair, validate } from "./schema.js";
import { applyTransactionAtomic } from "./transactions.js";
import { FoundationScopeIndex } from "./scope/resolveScope.js";
import { migrateNewlineTextToHardBreaks } from "./marks/hardBreak.js";
import { canonicalMarkOrder, createMarkNormalizer, marksAtInsertion } from "./marks/index.js";
import type {
  Attrs,
  NormalizerRegistration,
  PersistedEditorDocument,
  ResolvedPos,
  SmartHistory,
  SmartMark,
  SmartNode,
  SmartOperation,
  SmartRange,
  SmartSchema,
  SmartSelection,
  SmartTransaction,
} from "./types.js";
import type { PositionLookup, ScopeRequest, ScopeResult } from "./scope/types.js";

export interface FoundationEditorState extends PersistedEditorDocument {
  selection: SmartSelection;
  storedMarks?: SmartMark[];
}

export interface TransactOptions {
  source?: SmartTransaction["metadata"]["source"];
  timestamp?: number;
  historyGroup?: string;
  addToHistory?: boolean;
  compositionId?: string;
  authorId?: string;
}

export class TransactionBuilder {
  readonly operations: SmartOperation[] = [];
  selectionAfter: SmartSelection;
  storedMarksAfter?: SmartMark[];

  constructor(readonly selectionBefore: SmartSelection, storedMarks?: SmartMark[]) {
    this.selectionAfter = structuredClone(selectionBefore);
    this.storedMarksAfter = structuredClone(storedMarks);
  }

  insertNode(position: ResolvedPos, node: SmartNode) {
    this.operations.push({ type: "insertNode", pos: position.pos, node: structuredClone(node) });
  }

  removeNode(position: ResolvedPos, node: SmartNode) {
    this.operations.push({ type: "removeNode", pos: position.pos, node: structuredClone(node) });
  }

  replaceNode(position: ResolvedPos, before: SmartNode, after: SmartNode) {
    this.operations.push({ type: "replaceNode", pos: position.pos, before: structuredClone(before), after: structuredClone(after) });
  }

  moveNode(from: ResolvedPos, to: ResolvedPos, nodeId: string) {
    this.operations.push({ type: "moveNode", from: from.pos, to: to.pos, nodeId });
  }

  splitNode(position: ResolvedPos, depth: number, newId = createNodeId()) {
    this.operations.push({ type: "splitNode", pos: position.pos, depth, newId });
  }

  mergeNode(position: ResolvedPos, depth: number, retiredId: string, splitOffset: number) {
    this.operations.push({ type: "mergeNode", pos: position.pos, depth, retiredId, splitOffset });
  }

  setNodeAttributes(position: ResolvedPos, before: Attrs, after: Attrs) {
    this.operations.push({ type: "setNodeAttributes", pos: position.pos, before: structuredClone(before), after: structuredClone(after) });
  }

  setNodeType(position: ResolvedPos, before: string, after: string, beforeAttrs: Attrs, afterAttrs: Attrs) {
    this.operations.push({
      type: "setNodeType",
      pos: position.pos,
      before,
      after,
      beforeAttrs: structuredClone(beforeAttrs),
      afterAttrs: structuredClone(afterAttrs),
    });
  }

  insertText(position: ResolvedPos, text: string, marks?: SmartMark[]) {
    this.operations.push({ type: "insertText", pos: position.pos, text, ...(marks?.length ? { marks: structuredClone(marks) } : {}) });
  }

  deleteText(position: ResolvedPos, text: string, marks?: SmartMark[]) {
    this.operations.push({ type: "deleteText", pos: position.pos, text, ...(marks?.length ? { marks: structuredClone(marks) } : {}) });
  }

  addMark(range: SmartRange, mark: SmartMark) {
    this.operations.push({ type: "addMark", range: structuredClone(range), mark: structuredClone(mark) });
  }

  removeMark(range: SmartRange, mark: SmartMark) {
    this.operations.push({ type: "removeMark", range: structuredClone(range), mark: structuredClone(mark) });
  }

  setSelection(selection: SmartSelection) {
    this.selectionAfter = structuredClone(selection);
  }

  setStoredMarks(marks: SmartMark[] | undefined) {
    this.storedMarksAfter = structuredClone(marks);
  }
}

export interface FoundationEditorOptions {
  document: SmartNode;
  selection: SmartSelection;
  revision?: number;
  schema?: SmartSchema;
  normalizers?: readonly NormalizerRegistration[];
  historyLimit?: number;
  historyByteLimit?: number;
  coalescenceWindowMs?: number;
  storedMarks?: readonly SmartMark[];
}

export class FoundationEditor {
  readonly schema: SmartSchema;
  private current: FoundationEditorState;
  private currentHistory: SmartHistory;
  private readonly normalizers: readonly NormalizerRegistration[];
  private activeBuilder: TransactionBuilder | null = null;
  private listeners = new Set<(transaction: SmartTransaction, state: FoundationEditorState) => void>();
  private readonly semanticIndex = new FoundationScopeIndex();
  lastNormalization: NormalizationRun | null = null;

  constructor(options: FoundationEditorOptions) {
    this.schema = options.schema || foundationSchema;
    const candidate = options.document.type === "doc"
      ? options.document
      : { type: "doc", id: createNodeId(), children: [options.document] };
    const migrated = migrateNewlineTextToHardBreaks(candidate as FoundationEditorState["document"]);
    const repaired = repair(migrated.document, this.schema);
    const errors = validate(repaired.doc, this.schema);
    if (errors.length) throw new Error(`Initial document is invalid: ${errors[0].message}`);
    resolvePos(repaired.doc, options.selection.anchor);
    resolvePos(repaired.doc, options.selection.head);
    this.current = {
      schemaVersion: this.schema.version,
      revision: options.revision ?? 0,
      document: repaired.doc,
      selection: structuredClone(options.selection),
      ...(options.storedMarks?.length ? { storedMarks: canonicalMarkOrder(options.storedMarks) } : {}),
    };
    this.normalizers = [createMarkNormalizer(), ...(options.normalizers || [])];
    this.currentHistory = createHistory({
      limit: options.historyLimit,
      byteLimit: options.historyByteLimit,
      coalescenceWindowMs: options.coalescenceWindowMs,
    });
  }

  get state(): FoundationEditorState { return structuredClone(this.current); }
  get history(): SmartHistory { return structuredClone(this.currentHistory); }
  /** Readonly canonical references for memoized renderers and indexes. */
  get document(): FoundationEditorState["document"] { return this.current.document; }
  get selection(): SmartSelection { return structuredClone(this.current.selection); }
  get storedMarks(): readonly SmartMark[] | undefined { return this.current.storedMarks; }

  resolveScope(request: ScopeRequest, selection: SmartSelection = this.current.selection): ScopeResult {
    return this.semanticIndex.resolve(this.current.document, selection, request, this.schema);
  }

  get positions(): PositionLookup { return this.semanticIndex.positions(this.current.document, this.schema); }

  resolve(position: { pos: ResolvedPos["pos"]; affinity?: ResolvedPos["affinity"] }): ResolvedPos {
    return resolvePos(this.current.document, position.pos, position.affinity);
  }

  transact(callback: (transaction: TransactionBuilder) => unknown, options: TransactOptions = {}): SmartTransaction | null {
    if (this.activeBuilder) {
      const result = callback(this.activeBuilder);
      if (result && typeof (result as unknown as Promise<unknown>).then === "function") throw new Error("A transaction cannot remain open across await.");
      return null;
    }
    const builder = new TransactionBuilder(this.current.selection, this.current.storedMarks);
    this.activeBuilder = builder;
    try {
      const result = callback(builder);
      if (result && typeof (result as unknown as Promise<unknown>).then === "function") throw new Error("A transaction cannot remain open across await.");
    } finally {
      this.activeBuilder = null;
    }
    if (builder.operations.length && !builder.operations.every((operation) =>
      operation.type === "insertText" && (!this.current.storedMarks?.length
        || JSON.stringify(canonicalMarkOrder(operation.marks)) === JSON.stringify(canonicalMarkOrder(this.current.storedMarks))))) {
      builder.setStoredMarks(undefined);
    }
    const transaction: SmartTransaction = {
      id: createNodeId(),
      baseRevision: this.current.revision,
      operations: builder.operations,
      selectionBefore: structuredClone(builder.selectionBefore),
      selectionAfter: structuredClone(builder.selectionAfter),
      ...(this.current.storedMarks ? { storedMarksBefore: structuredClone(this.current.storedMarks) } : {}),
      ...(builder.storedMarksAfter ? { storedMarksAfter: structuredClone(builder.storedMarksAfter) } : {}),
      metadata: {
        source: options.source || "api",
        timestamp: options.timestamp ?? Date.now(),
        ...(options.historyGroup ? { historyGroup: options.historyGroup } : {}),
        addToHistory: options.addToHistory ?? builder.operations.length > 0,
        ...(options.compositionId ? { compositionId: options.compositionId } : {}),
        ...(options.authorId ? { authorId: options.authorId } : {}),
      },
    };
    this.dispatch(transaction);
    return transaction;
  }

  dispatch(input: SmartTransaction): void {
    if (input.baseRevision !== this.current.revision) {
      applyTransactionAtomic(this.current, input, this.schema);
      return;
    }
    const historyAttributeUpdates = input.metadata.addToHistory ? [] : input.operations.flatMap((operation) => {
      if (operation.type !== "setNodeAttributes") return [];
      const node = operation.pos.path.reduce<SmartNode | undefined>((current, part) =>
        current && !isTextNode(current) ? current.children?.[part] : undefined, this.current.document);
      return node && !isTextNode(node) ? [{ nodeId: node.id, before: operation.before, after: operation.after }] : [];
    });
    const afterUserOperations = applyOperations(this.current.document, input.operations);
    const normalization = runNormalization({
      document: afterUserOperations,
      originatingOperations: input.operations,
      schema: this.schema,
      normalizers: this.normalizers,
    });
    this.lastNormalization = normalization;
    const transaction = { ...structuredClone(input), operations: [...structuredClone(input.operations), ...normalization.operations] };
    const envelope = applyTransactionAtomic(this.current, transaction, this.schema);
    this.current = {
      ...envelope,
      selection: structuredClone(transaction.selectionAfter),
      storedMarks: structuredClone(transaction.storedMarksAfter),
    };
    this.currentHistory = recordHistory(this.currentHistory, transaction);
    historyAttributeUpdates.forEach((update) => {
      this.currentHistory = rebaseHistoryNodeAttributes(this.currentHistory, update.nodeId, update.before, update.after);
    });
    this.listeners.forEach((listener) => listener(structuredClone(transaction), this.state));
  }

  typeText(text: string, options: Omit<TransactOptions, "source"> = {}): SmartTransaction | null {
    const resolved = resolvePos(this.current.document, this.current.selection.head);
    const marks = this.current.storedMarks || marksAtInsertion(this.current.document, resolved.pos, this.schema);
    return this.transact((transaction) => {
      transaction.insertText(resolved, text, marks);
      const next = { path: [...resolved.pos.path], offset: resolved.pos.offset + text.length };
      transaction.setSelection({ type: "text", anchor: next, head: next });
    }, { ...options, source: "input", addToHistory: true });
  }

  setSelection(selection: SmartSelection, options: Omit<TransactOptions, "addToHistory"> = {}): SmartTransaction | null {
    return this.transact((transaction) => {
      transaction.setSelection(selection);
      transaction.setStoredMarks(undefined);
    }, { ...options, addToHistory: false });
  }

  setStoredMarks(marks: readonly SmartMark[] | undefined, options: Omit<TransactOptions, "addToHistory"> = {}): SmartTransaction | null {
    return this.transact((transaction) => transaction.setStoredMarks(marks?.length ? canonicalMarkOrder(marks) : undefined), {
      ...options, addToHistory: false,
    });
  }

  undo(): boolean {
    const popped = popUndo(this.currentHistory);
    if (!popped) return false;
    const inverse = { ...structuredClone(popped.entry.inverse), baseRevision: this.current.revision };
    const envelope = applyTransactionAtomic(this.current, inverse, this.schema);
    this.current = { ...envelope, selection: structuredClone(inverse.selectionAfter), storedMarks: structuredClone(inverse.storedMarksAfter) };
    this.currentHistory = popped.history;
    return true;
  }

  redo(): boolean {
    const popped = popRedo(this.currentHistory);
    if (!popped) return false;
    const forward = { ...structuredClone(popped.entry.forward), baseRevision: this.current.revision, metadata: { ...popped.entry.forward.metadata, addToHistory: false } };
    const envelope = applyTransactionAtomic(this.current, forward, this.schema);
    this.current = { ...envelope, selection: structuredClone(forward.selectionAfter), storedMarks: structuredClone(forward.storedMarksAfter) };
    this.currentHistory = popped.history;
    return true;
  }

  subscribe(listener: (transaction: SmartTransaction, state: FoundationEditorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const createFoundationEditor = (options: FoundationEditorOptions) => new FoundationEditor(options);
