import {
  createFoundationEditor,
  applyOperations,
  createInputPipeline,
  createNodeId,
  createSubtreeRenderer,
  createTransactionMap,
  foundationSchema,
  isTextNode,
  parseCanonicalListHtml,
  serializeCanonicalListHtml,
  type CanonicalInputPipeline,
  type ClipboardDiagnosticReport,
  type CanonicalSubtreeRenderer,
  type DocumentVersion,
  type FoundationEditor,
  type PersistedEditorDocument,
  type SmartMark,
  type SmartNode,
  type SmartOperation,
  type SmartPos,
  type SmartSelection,
  type SmartTransaction,
} from "smartrte-core/foundation";
import { capabilityPresetRegistry, type EditorCapabilityPreset } from "./capabilityPresets.js";

export interface SmartEditorCheckpoint {
  envelope: PersistedEditorDocument;
  selection: SmartSelection;
  storedMarks?: SmartMark[];
  savedRevision: number;
}

export interface SmartEditorChange {
  revision: number;
  documentChanged: boolean;
  transaction: SmartTransaction;
}

export interface SmartEditorHandle {
  getValue(): PersistedEditorDocument;
  replaceValue(doc: PersistedEditorDocument, opts?: { keepSelection?: boolean }): void;
  isDirty(): boolean;
  markSaved(revision: number): void;
  getRevision(): number;
  focus(): void;
  executeOperations(operations: readonly SmartOperation[], opts?: ExecuteOperationsOptions): void;
  createCheckpoint(): SmartEditorCheckpoint;
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void;
  saveVersion(opts?: SaveVersionOptions): DocumentVersion;
  restoreVersion(version: DocumentVersion, opts?: { keepSelection?: boolean }): void;
}

export interface SaveVersionOptions {
  label?: string;
  authorId?: string;
}

export interface ExecuteOperationsOptions {
  historyGroup?: string;
  addToHistory?: boolean;
  /** Keep structural commands anchored to the same stable inline-owner IDs. */
  preserveSelectionById?: boolean;
  /** Put the caret in a newly-created inline owner after the operation. */
  selectionOwnerId?: string;
  selectionOffset?: number;
}

export interface CanonicalEditorRuntimeOptions {
  initialValue?: string | PersistedEditorDocument;
  onChange?: (change: SmartEditorChange) => void;
  onHtmlChange?: (html: string) => void;
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
  /**
   * Renderer-integrated content-visibility (Phase 11 Tier 3, opt-in,
   * default off) - only applies content-visibility:auto to a top-level
   * block the renderer's own diff already proved untouched this render
   * pass and that isn't the actively-selected block. See
   * surface/renderer.ts's syncContentVisibility for why this differs from
   * the disproven naive per-block experiment.
   */
  contentVisibility?: boolean;
  /** Which built-in plugins this instance is constructed with - see capabilityPresets.ts. Defaults to "full" (every plugin), matching this runtime's only behavior before this option existed. */
  preset?: EditorCapabilityPreset;
  /**
   * Bakes real KaTeX-rendered HTML into `onHtmlChange`'s formula elements
   * instead of leaving them as empty placeholders (docs/bugs/
   * formula-not-rendered-in-static-html-consumers.md). Off by default -
   * the live editing surface already renders formulas correctly on its
   * own via surface/renderer.ts's imperative katex.render() calls, which
   * this option has no effect on; it exists purely for consumers that take
   * this HTML string and display it *without* also running KaTeX against
   * it themselves (e.g. a read-only preview panel built from saved HTML).
   */
  renderFormulaHtml?: boolean;
}

const nodeAtPath = (root: SmartNode, path: readonly number[]): SmartNode | null => {
  let node: SmartNode = root;
  for (const index of path) {
    if (isTextNode(node) || !node.children?.[index]) return null;
    node = node.children[index];
  }
  return node;
};

const pathOfNode = (root: SmartNode, nodeId: string, path: number[] = []): number[] | null => {
  if (!isTextNode(root) && root.id === nodeId) return path;
  if (isTextNode(root)) return null;
  for (let index = 0; index < (root.children?.length || 0); index += 1) {
    const found = pathOfNode(root.children![index], nodeId, [...path, index]);
    if (found) return found;
  }
  return null;
};

const inlineWidth = (node: SmartNode): number => isTextNode(node)
  ? node.text.length
  : node.children?.reduce((width, child) => width + (isTextNode(child) ? child.text.length : 1), 0) ?? 0;

const firstTextSelection = (document: PersistedEditorDocument["document"]): SmartSelection => {
  const visit = (node: SmartNode, path: number[]): SmartPos | null => {
    if (isTextNode(node)) return null;
    const spec = foundationSchema.nodes[node.type];
    const children = node.children || [];
    // Atomic nodes (e.g. block_image) never accept a text caret inside them,
    // even when they report an empty children array - only a genuine
    // text-content container (an empty or all-inline block) is a valid
    // first-text-selection target.
    if (spec?.group === "block" && !spec.atomic && (children.length === 0 || children.every((child) =>
      isTextNode(child) || foundationSchema.nodes[child.type]?.group === "inline"))) return { path, offset: 0 };
    for (let index = 0; index < children.length; index += 1) {
      const found = visit(children[index], [...path, index]);
      if (found) return found;
    }
    return null;
  };
  const pos = visit(document, []) || { path: [], offset: 0 };
  return { type: "text", anchor: pos, head: pos };
};

const envelopeFrom = (value?: string | PersistedEditorDocument): PersistedEditorDocument => {
  if (typeof value === "object" && value) return structuredClone(value);
  const document = parseCanonicalListHtml(typeof value === "string" ? value : "<p></p>");
  return { schemaVersion: foundationSchema.version, revision: 0, document };
};

const sameOperations = (transaction: SmartTransaction) => transaction.operations.length > 0;

const cellIdAt = (document: SmartNode, position: SmartPos): string | null => {
  const node = nodeAtPath(document, position.path);
  return node && !isTextNode(node) && node.type === "table_cell" ? node.id : null;
};

const cellSelectionIn = (document: SmartNode, anchorId: string, headId: string): SmartSelection | null => {
  const anchorPath = pathOfNode(document, anchorId) || pathOfNode(document, headId);
  const headPath = pathOfNode(document, headId) || anchorPath;
  if (!anchorPath || !headPath) return null;
  const anchor = nodeAtPath(document, anchorPath);
  const head = nodeAtPath(document, headPath);
  if (!anchor || isTextNode(anchor) || anchor.type !== "table_cell"
    || !head || isTextNode(head) || head.type !== "table_cell") return null;
  return {
    type: "cell",
    anchor: { path: anchorPath, offset: 0 },
    head: { path: headPath, offset: head.children?.length || 0 },
  };
};

/** Persistent, React-independent owner for one product editor instance. */
export class CanonicalEditorRuntime implements SmartEditorHandle {
  readonly editor: FoundationEditor;
  private root: HTMLElement | null = null;
  private renderer: CanonicalSubtreeRenderer | null = null;
  private pipeline: CanonicalInputPipeline | null = null;
  private unsubscribe: (() => void) | null = null;
  private savedRevision: number;
  private onChange?: (change: SmartEditorChange) => void;
  private onHtmlChange?: (html: string) => void;
  private readonly onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
  private readonly contentVisibility: boolean;
  private readonly renderFormulaHtml: boolean;
  private htmlChangeTimer: number | null = null;
  private pendingHtmlDocument: PersistedEditorDocument["document"] | null = null;

  constructor(options: CanonicalEditorRuntimeOptions = {}) {
    const envelope = envelopeFrom(options.initialValue);
    // "full" (the default) intentionally passes no schema/commands/etc., so
    // FoundationEditor's own defaulting (`options.schema || foundationSchema`)
    // applies - every existing consumer who never sets `preset` is
    // byte-for-byte unaffected by this option existing.
    const registry = options.preset && options.preset !== "full" ? capabilityPresetRegistry(options.preset) : null;
    this.editor = createFoundationEditor({
      document: envelope.document,
      revision: envelope.revision,
      selection: firstTextSelection(envelope.document),
      ...(registry ? { schema: registry.schema, commands: registry.commands, keyboardShortcuts: registry.keyboardShortcuts, contextMenu: registry.contextMenu } : {}),
    });
    this.savedRevision = envelope.revision;
    this.onChange = options.onChange;
    this.onHtmlChange = options.onHtmlChange;
    this.onClipboardDiagnostic = options.onClipboardDiagnostic;
    this.contentVisibility = options.contentVisibility === true;
    this.renderFormulaHtml = options.renderFormulaHtml === true;
  }

  setCallbacks(onChange?: (change: SmartEditorChange) => void, onHtmlChange?: (html: string) => void): void {
    this.onChange = onChange;
    this.onHtmlChange = onHtmlChange;
  }

  private scheduleHtmlChange(document: PersistedEditorDocument["document"]): void {
    if (!this.onHtmlChange) return;
    this.pendingHtmlDocument = document;
    const view = this.root?.ownerDocument.defaultView;
    if (this.htmlChangeTimer !== null) {
      if (view) view.clearTimeout(this.htmlChangeTimer);
      else globalThis.clearTimeout(this.htmlChangeTimer);
    }
    const flush = () => {
      this.htmlChangeTimer = null;
      const pending = this.pendingHtmlDocument;
      this.pendingHtmlDocument = null;
      if (pending && this.onHtmlChange) this.onHtmlChange(serializeCanonicalListHtml(pending, { clean: true, renderFormulaHtml: this.renderFormulaHtml }));
    };
    if (view) {
      // Transitional HTML serialization is intentionally debounced outside the
      // typing frame. The canonical onChange contract remains per transaction.
      this.htmlChangeTimer = view.setTimeout(flush, 250);
    } else {
      this.htmlChangeTimer = setTimeout(flush, 250) as unknown as number;
    }
  }

  mount(root: HTMLElement): void {
    if (this.root === root && this.pipeline && this.renderer) return;
    this.unmount();
    this.root = root;
    this.renderer = createSubtreeRenderer(root, { contentVisibility: this.contentVisibility });
    this.pipeline = createInputPipeline(this.editor, this.renderer, root, { onClipboardDiagnostic: this.onClipboardDiagnostic });
    this.unsubscribe = this.editor.subscribe((transaction, state) => {
      this.renderer?.render(this.editor.document, this.editor.selection);
      this.onChange?.({ revision: state.revision, documentChanged: sameOperations(transaction), transaction });
      if (sameOperations(transaction)) this.scheduleHtmlChange(state.document);
    });
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pipeline?.destroy();
    this.pipeline = null;
    this.renderer?.destroy();
    this.renderer = null;
    const view = this.root?.ownerDocument.defaultView;
    if (this.htmlChangeTimer !== null) {
      if (view) view.clearTimeout(this.htmlChangeTimer);
      else globalThis.clearTimeout(this.htmlChangeTimer);
    }
    this.htmlChangeTimer = null;
    this.pendingHtmlDocument = null;
    this.root?.replaceChildren();
    this.root = null;
  }

  getValue(): PersistedEditorDocument {
    const state = this.editor.state;
    return { schemaVersion: state.schemaVersion, revision: state.revision, document: state.document };
  }

  replaceValue(doc: PersistedEditorDocument, opts: { keepSelection?: boolean } = {}): void {
    let selection = firstTextSelection(doc.document);
    if (opts.keepSelection) {
      const current = this.editor.selection;
      const owner = nodeAtPath(this.editor.document, current.head.path);
      if (owner && !isTextNode(owner)) {
        const find = (node: SmartNode, path: number[]): number[] | null => {
          if (!isTextNode(node) && node.id === owner.id) return path;
          if (isTextNode(node)) return null;
          for (let index = 0; index < (node.children?.length || 0); index += 1) {
            const found = find(node.children![index], [...path, index]);
            if (found) return found;
          }
          return null;
        };
        const path = find(doc.document, []);
        if (path) {
          const replacementOwner = nodeAtPath(doc.document, path)!;
          const offset = Math.min(current.head.offset, inlineWidth(replacementOwner));
          const pos = { path, offset };
          selection = { type: "text", anchor: pos, head: pos };
        }
      }
    }
    this.editor.replaceState(doc, { selection });
  }

  isDirty(): boolean { return this.editor.state.revision !== this.savedRevision; }
  markSaved(revision: number): void {
    if (revision > this.editor.state.revision) throw new Error("Cannot mark a future revision as saved.");
    this.savedRevision = revision;
  }
  getRevision(): number { return this.editor.state.revision; }
  focus(): void { this.root?.focus(); }
  executeOperations(operations: readonly SmartOperation[], opts: ExecuteOperationsOptions = {}): void {
    if (!operations.length) return;
    const beforeSelection = this.editor.selection;
    let selection = createTransactionMap(operations).mapSelection(beforeSelection);
    if (opts.selectionOwnerId || opts.preserveSelectionById) {
      const beforeDocument = this.editor.document;
      const preview = applyOperations(beforeDocument, operations);
      const beforeCellAnchor = beforeSelection.type === "cell" ? cellIdAt(beforeDocument, beforeSelection.anchor) : null;
      const beforeCellHead = beforeSelection.type === "cell" ? cellIdAt(beforeDocument, beforeSelection.head) : null;
      let preservedCellSelection = false;
      if (opts.preserveSelectionById && beforeCellAnchor && beforeCellHead) {
        // Structural table commands may retire the head cell (merge) while
        // preserving the anchor. Keep the selection on the surviving cell so
        // the next table command still has an unambiguous scope.
        const mappedCells = cellSelectionIn(preview, beforeCellAnchor, beforeCellHead);
        if (mappedCells) {
          selection = mappedCells;
          preservedCellSelection = true;
        }
      }
      const point = (pos: SmartPos, forcedId?: string): SmartPos | null => {
        const beforeOwner = nodeAtPath(beforeDocument, pos.path);
        const ownerId = forcedId || (!beforeOwner || isTextNode(beforeOwner) ? undefined : beforeOwner.id);
        if (!ownerId) return null;
        const path = pathOfNode(preview, ownerId);
        if (!path) return null;
        const owner = nodeAtPath(preview, path);
        if (!owner) return null;
        return { path, offset: Math.min(forcedId ? opts.selectionOffset ?? 0 : pos.offset, inlineWidth(owner)) };
      };
      if (preservedCellSelection) {
        // The cell selection was mapped above; do not reinterpret its
        // structural endpoints as a text selection.
      } else if (opts.selectionOwnerId) {
        const caret = point(beforeSelection.head, opts.selectionOwnerId);
        if (caret) selection = { type: "text", anchor: caret, head: caret };
      } else {
        const anchor = point(beforeSelection.anchor);
        const head = point(beforeSelection.head);
        if (anchor && head) selection = { ...beforeSelection, anchor, head };
      }
    }
    this.editor.transact((builder) => {
      builder.operations.push(...operations);
      builder.setSelection(selection);
    }, {
      source: "toolbar",
      addToHistory: opts.addToHistory ?? true,
      ...(opts.historyGroup ? { historyGroup: opts.historyGroup } : {}),
    });
    // Skipped for a non-history (preview) operation: focusing the main
    // editor surface would steal keyboard/pointer focus away from whatever
    // UI is driving the preview (e.g. ColorPickerPopover's native color
    // input mid-drag) on every single preview frame - breaking Escape-to-
    // cancel and, in a real browser, potentially interrupting the drag
    // itself. A real, history-eligible commit still focuses as before.
    if (opts.addToHistory ?? true) this.focus();
  }
  createCheckpoint(): SmartEditorCheckpoint {
    return {
      envelope: this.getValue(),
      selection: this.editor.selection,
      ...(this.editor.storedMarks?.length ? { storedMarks: [...structuredClone(this.editor.storedMarks)] } : {}),
      savedRevision: this.savedRevision,
    };
  }
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void {
    this.editor.replaceState(checkpoint.envelope, {
      selection: checkpoint.selection,
      storedMarks: checkpoint.storedMarks,
    });
    this.savedRevision = checkpoint.savedRevision;
  }
  /**
   * A pure read of current state, like `createCheckpoint` - never touches
   * the undo stack, never a `transact()` call. The runtime doesn't call a
   * `VersionProvider` itself (same division as `mediaProvider.upload`
   * being called directly from the React component, not the runtime) -
   * this just builds the payload a caller then hands to a provider.
   */
  saveVersion(opts: SaveVersionOptions = {}): DocumentVersion {
    return { id: createNodeId(), createdAt: Date.now(), envelope: this.getValue(), ...(opts.label ? { label: opts.label } : {}), ...(opts.authorId ? { authorId: opts.authorId } : {}) };
  }
  /**
   * Reuses `replaceValue` (the same "load a full snapshot" mechanism
   * `restoreCheckpoint` already uses) rather than replaying the version as
   * a sequence of operations - a version can be arbitrarily old, and
   * `replaceState` already validates/repairs an incoming document the same
   * way loading any document does. Deliberately does NOT reuse the
   * version's own stored `revision`: `replaceState` sets the live
   * revision counter to whatever it's given verbatim, so restoring an old
   * version's envelope as-is would roll a monotonic counter backward -
   * colliding with `StaleTransactionError`'s bookkeeping and this
   * runtime's own `isDirty()` comparison. Always re-stamps to
   * `currentRevision + 1` instead. Not undoable, same as checkpoint
   * restore today (`replaceState`'s emitted transaction always sets
   * `addToHistory: false`). Per the Phase 12a spec's explicit
   * recommendation, restore is non-destructive of version history at the
   * UI layer: the caller (`VersionHistoryPanel`) saves a new version
   * recording the restored state immediately after calling this, rather
   * than this method silently discarding anything - the version list only
   * ever grows, never rewrites.
   */
  restoreVersion(version: DocumentVersion, opts: { keepSelection?: boolean } = {}): void {
    const restamped: PersistedEditorDocument = {
      schemaVersion: version.envelope.schemaVersion,
      revision: this.getRevision() + 1,
      document: version.envelope.document,
    };
    this.replaceValue(restamped, opts);
  }

  /** Instrumentation for product-path composition and takeover tests. */
  get surface() { return { root: this.root, renderer: this.renderer, pipeline: this.pipeline }; }
}

export const createCanonicalEditorRuntime = (options: CanonicalEditorRuntimeOptions = {}) => new CanonicalEditorRuntime(options);
