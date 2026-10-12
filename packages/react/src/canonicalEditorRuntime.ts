import {
  createFoundationEditor,
  applyOperations,
  atomDeclarations,
  filterImageMetadata,
  getSectionContext as sectionContextOf,
  listDocumentImages,
  listSections as sectionsOf,
  sectionEndIndex,
  topLevelIndexOf,
  normalizeImageCaption,
  normalizeImageMetadataAllowlist,
  sanitizeAtomSource,
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
  type DocumentImageInfo,
  type DocumentSection,
  type DocumentVersion,
  type FoundationEditor,
  type PersistedEditorDocument,
  type SmartMark,
  type SmartNode,
  type SmartOperation,
  type SmartPos,
  type SmartSelection,
  type SectionContext,
  type SectionContextOptions,
  type SmartTransaction,
} from "smartrte-core/foundation";
import { capabilityPresetRegistry, type EditorCapabilityPreset } from "./capabilityPresets.js";
import { planBlockAtomInsertion } from "./insertion.js";

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
  /** Inserts a block image from the host app (e.g. a side panel) at the last caret position. Never throws for bad input: see InsertImageResult. */
  insertImage(input: InsertImageInput, opts?: InsertImageOptions): InsertImageResult;
  /** The section around the last caret position: nearest top-level heading above it and that section's plain text. Allowed in read-only mode. */
  getSectionContext(opts?: SectionContextOptions): SectionContext & { caretSetByUser: boolean };
  /** Every block and inline image, in document order. */
  listImages(): DocumentImageInfo[];
  /** Every top-level heading, in order - the sections getSectionContext and insertImage's `sectionEnd` use. */
  listSections(): DocumentSection[];
  /** True once the user has placed the caret (pointer, touch or keyboard) since the document was last loaded or replaced. */
  hasUserCaret(): boolean;
}

export interface InsertImageInput {
  /** Used as given - no upload, no data-URL conversion. Must pass the same image URL policy as every other image path. */
  src: string;
  /** Required unless `decorative: true`. */
  alt: string;
  decorative?: boolean;
  /** Plain text; normalised (whitespace collapsed) and capped at 500 characters. */
  caption?: string;
  width?: number;
  height?: number;
  align?: "left" | "center" | "right";
  /** Filtered by the editor's `imageMetadataAttributes` allowlist; anything else is dropped. */
  metadata?: Record<string, string>;
}

export type InsertImagePosition =
  /** After the block at the last caret position, like the toolbar (default). Falls back to "end" if that caret can't take a block. */
  | "selection"
  /** Appended to the document. */
  | "end"
  /** At the end of the section this top-level heading starts (before the next top-level heading of the same or higher level); `null` is the part before the first heading. */
  | { sectionEnd: string | null }
  /** Directly after this top-level block. */
  | { after: string };

export interface InsertImageOptions {
  /** Default "selection". An unknown `sectionEnd`/`after` id returns `no_valid_position` rather than inserting elsewhere. */
  position?: InsertImagePosition;
  /** Default false: the host's own panel keeps focus. */
  focus?: boolean;
}

export type InsertImageResult =
  | { ok: true; nodeId: string }
  | { ok: false; reason: "read_only" | "invalid_image" | "no_valid_position" };

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
  /** Select this (newly inserted) node as a node selection after the operation. */
  selectNodeId?: string;
  /** Focus the editor after a history-eligible commit. Default true (the long-standing behaviour); host APIs pass false so the host's panel keeps focus. */
  focus?: boolean;
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
  /**
   * Host-defined `data-*` attributes (e.g. `["data-ai-generated",
   * "data-source"]`) that block images keep as `attrs.metadata` through
   * HTML loading, paste and insertImage, and write back out on export.
   * Names must match `data-[a-z0-9-]+`, may not start with `data-smart-`,
   * at most 40 characters, at most 10 names; invalid names are dropped with
   * a development-mode warning. Default: none, so no behaviour changes.
   */
  imageMetadataAttributes?: readonly string[];
}

/** Input that places a caret inside the editor - see hasUserCaret(). */
const USER_CARET_EVENTS = ["pointerdown", "mousedown", "touchstart", "keydown"] as const;

const isDevelopment = () => {
  const global = globalThis as typeof globalThis & { process?: { env?: { NODE_ENV?: string } } };
  return global.process?.env?.NODE_ENV !== "production";
};

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

const envelopeFrom = (value: string | PersistedEditorDocument | undefined, imageMetadataAttributes: readonly string[]): PersistedEditorDocument => {
  if (typeof value === "object" && value) return structuredClone(value);
  const document = parseCanonicalListHtml(typeof value === "string" ? value : "<p></p>", { imageMetadataAttributes });
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
  private readOnly = false;
  /** Set only while executeOperations commits with `focus: false` - see the subscribe callback in mount(). */
  private holdDomSelection = false;
  /** See hasUserCaret(). */
  private userCaret = false;
  private readonly markUserCaret = () => { this.userCaret = true; };
  /** hasUserCaret() as it was when each of this runtime's checkpoints was taken. A WeakMap so the checkpoint object stays the public, serializable shape. */
  private readonly checkpointUserCaret = new WeakMap<SmartEditorCheckpoint, boolean>();
  /** The validated `imageMetadataAttributes` allowlist. Hosts that call parseCanonicalListHtml themselves should pass this same list. */
  readonly imageMetadataAttributes: readonly string[];

  constructor(options: CanonicalEditorRuntimeOptions = {}) {
    const allowlist = normalizeImageMetadataAllowlist(options.imageMetadataAttributes);
    if (allowlist.rejected.length && isDevelopment()) {
      console.warn(`[Smart RTE] imageMetadataAttributes: ignored invalid or excess names: ${allowlist.rejected.join(", ")}. Names must match data-[a-z0-9-]+, must not start with data-smart-, be at most 40 characters, and at most 10 names are kept.`);
    }
    this.imageMetadataAttributes = allowlist.names;
    const envelope = envelopeFrom(options.initialValue, this.imageMetadataAttributes);
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
    // hasUserCaret: transaction sources can't tell user selection from
    // programmatic selection (DOM selection sync and atom clicks both
    // report "api"), so track the input events that place a caret instead.
    // Capture phase, so an input handler that stops propagation still counts.
    for (const type of USER_CARET_EVENTS) root.addEventListener(type, this.markUserCaret, true);
    this.renderer = createSubtreeRenderer(root, { contentVisibility: this.contentVisibility });
    this.pipeline = createInputPipeline(this.editor, this.renderer, root, { onClipboardDiagnostic: this.onClipboardDiagnostic, imageMetadataAttributes: this.imageMetadataAttributes });
    this.unsubscribe = this.editor.subscribe((transaction, state) => {
      // A commit that must not take focus (a host panel calling insertImage)
      // also must not move the browser selection into the editor: in real
      // browsers that alone moves focus to the contenteditable.
      this.renderer?.render(this.editor.document, this.editor.selection, { syncDomSelection: !this.holdDomSelection });
      this.onChange?.({ revision: state.revision, documentChanged: sameOperations(transaction), transaction });
      if (sameOperations(transaction)) this.scheduleHtmlChange(state.document);
    });
  }

  unmount(): void {
    if (this.root) for (const type of USER_CARET_EVENTS) this.root.removeEventListener(type, this.markUserCaret, true);
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
    this.userCaret = false;
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
    if (opts.selectionOwnerId || opts.preserveSelectionById || opts.selectNodeId) {
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
      if (opts.selectNodeId) {
        const path = pathOfNode(preview, opts.selectNodeId);
        if (path?.length) {
          const parentPath = path.slice(0, -1);
          const index = path[path.length - 1];
          selection = { type: "node", anchor: { path: parentPath, offset: index }, head: { path: parentPath, offset: index + 1 } };
        }
      } else if (preservedCellSelection) {
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
    this.holdDomSelection = opts.focus === false;
    try {
      this.editor.transact((builder) => {
        builder.operations.push(...operations);
        builder.setSelection(selection);
      }, {
        source: "toolbar",
        addToHistory: opts.addToHistory ?? true,
        ...(opts.historyGroup ? { historyGroup: opts.historyGroup } : {}),
      });
    } finally {
      this.holdDomSelection = false;
    }
    // Skipped for a non-history (preview) operation: focusing the main
    // editor surface would steal keyboard/pointer focus away from whatever
    // UI is driving the preview (e.g. ColorPickerPopover's native color
    // input mid-drag) on every single preview frame - breaking Escape-to-
    // cancel and, in a real browser, potentially interrupting the drag
    // itself. A real, history-eligible commit still focuses as before.
    if ((opts.addToHistory ?? true) && opts.focus !== false) this.focus();
  }

  /** Mirrors the component's `readOnly` prop so host-facing APIs (insertImage) can refuse writes. Does not itself change the editing surface. */
  setReadOnly(readOnly: boolean): void { this.readOnly = readOnly; }
  isReadOnly(): boolean { return this.readOnly; }

  insertImage(input: InsertImageInput, opts: InsertImageOptions = {}): InsertImageResult {
    if (this.readOnly) return { ok: false, reason: "read_only" };
    const attrs = this.imageAttrsFrom(input);
    if (!attrs) return { ok: false, reason: "invalid_image" };
    const nodeId = createNodeId();
    const position = opts.position ?? "selection";
    let plan;
    if (typeof position === "object" && position) {
      // A host-named place: resolve it to a document-root index, and fail
      // rather than silently insert somewhere the host didn't ask for.
      const document = this.editor.document;
      const rootIndex = "sectionEnd" in position
        ? sectionEndIndex(document, position.sectionEnd)
        : "after" in position && typeof position.after === "string"
          ? (() => { const index = topLevelIndexOf(document, position.after); return index === null ? null : index + 1; })()
          : null;
      plan = rootIndex === null ? null : planBlockAtomInsertion(this.editor, "block_image", attrs, nodeId, { rootIndex });
    } else {
      // An unusable caret position (none yet, or one that can't take a block
      // here) falls back to appending - still a successful insert.
      plan = (position !== "end" ? planBlockAtomInsertion(this.editor, "block_image", attrs, nodeId, "selection") : null)
        || planBlockAtomInsertion(this.editor, "block_image", attrs, nodeId, "end");
    }
    if (!plan) return { ok: false, reason: "no_valid_position" };
    this.executeOperations(plan.operations, { selectNodeId: nodeId, focus: opts.focus === true });
    return { ok: true, nodeId };
  }

  /** Builds and validates block_image attrs from host input, or null if they would be invalid. */
  private imageAttrsFrom(input: InsertImageInput): Record<string, unknown> | null {
    if (!input || typeof input !== "object") return null;
    const decorative = input.decorative === true;
    const alt = typeof input.alt === "string" ? input.alt : decorative ? "" : null;
    const src = typeof input.src === "string" ? sanitizeAtomSource(input.src, { kind: "image" }) : null;
    if (alt === null || !src) return null;
    const dimension = (value: unknown) => value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000);
    if (!dimension(input.width) || !dimension(input.height)) return null;
    if (input.align !== undefined && input.align !== "left" && input.align !== "center" && input.align !== "right") return null;
    const caption = normalizeImageCaption(input.caption);
    const metadata = input.metadata && typeof input.metadata === "object"
      ? filterImageMetadata((name) => (input.metadata as Record<string, unknown>)[name], this.imageMetadataAttributes)
      : undefined;
    const attrs: Record<string, unknown> = {
      src, alt, status: "ready",
      ...(decorative ? { decorative: true } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.align ? { align: input.align } : {}),
      ...(caption ? { caption } : {}),
      ...(metadata ? { metadata } : {}),
    };
    const spec = this.editor.schema.nodes.block_image;
    if (!spec) return null;
    const schemaValid = Object.entries(attrs).every(([name, value]) => spec.attributes?.[name]?.validate?.(value) ?? true);
    const declaration = atomDeclarations.find((entry) => entry.type === "block_image");
    return schemaValid && declaration?.validate(attrs) ? attrs : null;
  }

  getSectionContext(opts?: SectionContextOptions): SectionContext & { caretSetByUser: boolean } {
    return { ...sectionContextOf(this.editor.document, this.editor.selection, opts), caretSetByUser: this.userCaret };
  }

  listImages(): DocumentImageInfo[] {
    return listDocumentImages(this.editor.document);
  }

  listSections(): DocumentSection[] {
    return sectionsOf(this.editor.document);
  }

  hasUserCaret(): boolean { return this.userCaret; }
  createCheckpoint(): SmartEditorCheckpoint {
    const checkpoint: SmartEditorCheckpoint = {
      envelope: this.getValue(),
      selection: this.editor.selection,
      ...(this.editor.storedMarks?.length ? { storedMarks: [...structuredClone(this.editor.storedMarks)] } : {}),
      savedRevision: this.savedRevision,
    };
    this.checkpointUserCaret.set(checkpoint, this.userCaret);
    return checkpoint;
  }
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void {
    // The caret comes back with the checkpoint's selection, so whether the
    // user placed it does too (the component restores checkpoints to cancel
    // colour/border previews mid-edit). A checkpoint from elsewhere, e.g.
    // deserialized, resets it like any other document load.
    this.userCaret = this.checkpointUserCaret.get(checkpoint) ?? false;
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
