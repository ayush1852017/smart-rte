import {
  createFoundationEditor,
  createInputPipeline,
  createSubtreeRenderer,
  foundationSchema,
  isTextNode,
  parseCanonicalListHtml,
  serializeCanonicalListHtml,
  type CanonicalInputPipeline,
  type ClipboardDiagnosticReport,
  type CanonicalSubtreeRenderer,
  type FoundationEditor,
  type PersistedEditorDocument,
  type SmartMark,
  type SmartNode,
  type SmartPos,
  type SmartSelection,
  type SmartTransaction,
} from "smartrte-core/foundation";

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
  createCheckpoint(): SmartEditorCheckpoint;
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void;
}

export interface CanonicalEditorRuntimeOptions {
  initialValue?: string | PersistedEditorDocument;
  onChange?: (change: SmartEditorChange) => void;
  onHtmlChange?: (html: string) => void;
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
}

const nodeAtPath = (root: SmartNode, path: readonly number[]): SmartNode | null => {
  let node: SmartNode = root;
  for (const index of path) {
    if (isTextNode(node) || !node.children?.[index]) return null;
    node = node.children[index];
  }
  return node;
};

const inlineWidth = (node: SmartNode): number => isTextNode(node)
  ? node.text.length
  : node.children?.reduce((width, child) => width + (isTextNode(child) ? child.text.length : 1), 0) ?? 0;

const firstTextSelection = (document: PersistedEditorDocument["document"]): SmartSelection => {
  const visit = (node: SmartNode, path: number[]): SmartPos | null => {
    if (isTextNode(node)) return null;
    const spec = foundationSchema.nodes[node.type];
    const children = node.children || [];
    if (spec?.group === "block" && (children.length === 0 || children.every((child) =>
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
  private htmlChangeTimer: number | null = null;
  private pendingHtmlDocument: PersistedEditorDocument["document"] | null = null;

  constructor(options: CanonicalEditorRuntimeOptions = {}) {
    const envelope = envelopeFrom(options.initialValue);
    this.editor = createFoundationEditor({
      document: envelope.document,
      revision: envelope.revision,
      selection: firstTextSelection(envelope.document),
    });
    this.savedRevision = envelope.revision;
    this.onChange = options.onChange;
    this.onHtmlChange = options.onHtmlChange;
    this.onClipboardDiagnostic = options.onClipboardDiagnostic;
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
      if (pending && this.onHtmlChange) this.onHtmlChange(serializeCanonicalListHtml(pending, { clean: true }));
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
    this.renderer = createSubtreeRenderer(root);
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

  /** Instrumentation for product-path composition and takeover tests. */
  get surface() { return { root: this.root, renderer: this.renderer, pipeline: this.pipeline }; }
}

export const createCanonicalEditorRuntime = (options: CanonicalEditorRuntimeOptions = {}) => new CanonicalEditorRuntime(options);
