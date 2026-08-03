import type {
  LegacySmartDocument,
  SmartEditorState,
  SmartRtePlugin,
  LegacySmartSelection,
  LegacySmartTransaction,
} from "smartrte-core/legacy";
import { applyTransaction, invertLegacyTransaction } from "smartrte-core/legacy";
import { createSmartEditor } from "smartrte-core/legacy";
import { executeDomCommand, type DomCommandResult } from "./adapters/domCommandBridge.js";
import {
  executeDomBlockCommand,
  type DomBlockCommand,
} from "./adapters/domBlockCommandBridge.js";
import { executeDomChecklistItemCommand } from "./adapters/domChecklistCommandBridge.js";
import {
  executeDomInlineImageCommand,
  executeDomInlineImageUpdate,
  type DomInlineImageInput,
} from "./adapters/domInlineImageCommandBridge.js";
import {
  executeDomFormulaInsert,
  executeDomInlineAtomDelete,
  type DomFormulaInput,
} from "./adapters/domInlineAtomCommandBridge.js";
import {
  executeDomTableCommand,
  executeDomTableRemoval,
  type DomTableCommand,
} from "./adapters/domTableCommandBridge.js";
import { restoreSelectionToDom, selectionFromDom } from "./adapters/domSelectionBridge.js";
import {
  serializeSmartDocument,
  smartDocumentFromEditorRoot,
  smartDocumentFromHtml,
} from "./adapters/domSmartDocument.js";

export interface DomEditorControllerSnapshot {
  document: LegacySmartDocument;
  selection: LegacySmartSelection | null;
  html: string;
}

export interface DomEditorControllerChange {
  commandId: string;
  snapshot: DomEditorControllerSnapshot;
}

export type DomEditorControllerListener = (change: DomEditorControllerChange) => void;

interface DomHistorySnapshot {
  html: string;
  selection: LegacySmartSelection | null;
  version: number;
  canonical?: {
    forward: LegacySmartTransaction;
    inverse: LegacySmartTransaction;
  };
}

/**
 * Owns the canonical boundary between a contenteditable root and LegacySmartDocument.
 *
 * React remains responsible for rendering UI and legacy DOM-only commands while
 * model commands, document snapshots, serialization, and replacement flow
 * through this controller.
 */
export class DomEditorController {
  private root: HTMLElement | null = null;
  private plugins: readonly SmartRtePlugin[] = [];
  private readOnly = false;
  private readonly listeners = new Set<DomEditorControllerListener>();
  private readonly undoStack: DomHistorySnapshot[] = [];
  private readonly redoStack: DomHistorySnapshot[] = [];
  private historyLimit = 100;
  private mutationVersion = 0;
  private canonicalState: SmartEditorState | null = null;

  bindRoot(root: HTMLElement | null) {
    this.root = root;
    return this;
  }

  configure(options: {
    plugins?: readonly SmartRtePlugin[];
    readOnly?: boolean;
    historyLimit?: number;
  }) {
    if (options.plugins) this.plugins = options.plugins;
    if (options.readOnly !== undefined) this.readOnly = options.readOnly;
    if (options.historyLimit !== undefined) {
      this.historyLimit = Math.max(1, Math.floor(options.historyLimit));
    }
    return this;
  }

  snapshot(): DomEditorControllerSnapshot | null {
    if (!this.root) return null;
    const { document } = smartDocumentFromEditorRoot(this.root);
    const selection = selectionFromDom(
      this.root,
      this.root.ownerDocument.defaultView?.getSelection() || null,
    );
    const snapshot = {
      document,
      selection,
      html: serializeSmartDocument(document),
    };
    this.canonicalState = selection ? { document, selection } : null;
    return snapshot;
  }

  getDocument(): LegacySmartDocument {
    return this.snapshot()?.document || { type: "doc", children: [] };
  }

  getState(): SmartEditorState | null {
    const snapshot = this.snapshot();
    return snapshot?.selection
      ? { document: snapshot.document, selection: snapshot.selection }
      : null;
  }

  canExecute<Input>(commandId: string, input?: Input): boolean {
    if (!this.root || this.readOnly) return false;
    const state = this.getState();
    if (!state) return false;
    return createSmartEditor({
      state,
      plugins: [...this.plugins],
      readOnly: this.readOnly,
    }).canExecute(commandId, input);
  }

  recordHistorySnapshot(html?: string) {
    if (!this.root || this.readOnly) return false;
    const snapshot = this.snapshot();
    const entry: DomHistorySnapshot = {
      html: html ?? this.root.innerHTML,
      selection: snapshot?.selection || null,
      version: this.mutationVersion,
    };
    if (this.undoStack[this.undoStack.length - 1]?.html === entry.html) return false;
    this.undoStack.push(entry);
    this.promoteHistoryEntry(entry, snapshot);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  discardLastHistorySnapshot(expectedHtml?: string) {
    const latest = this.undoStack[this.undoStack.length - 1];
    if (!latest || expectedHtml !== undefined && latest.html !== expectedHtml) return false;
    this.undoStack.pop();
    return true;
  }

  restoreHistory(direction: "undo" | "redo"): DomHistorySnapshot | null {
    if (!this.root || this.readOnly) return null;
    const from = direction === "undo" ? this.undoStack : this.redoStack;
    const to = direction === "undo" ? this.redoStack : this.undoStack;
    let entry: DomHistorySnapshot | undefined;
    while (from.length) {
      const candidate = from.pop()!;
      if (candidate.html !== this.root.innerHTML) {
        entry = candidate;
        break;
      }
    }
    if (!entry) return null;
    const current = this.snapshot();
    if (entry.canonical && current) {
      const transaction = direction === "undo"
        ? entry.canonical.inverse
        : entry.canonical.forward;
      this.canonicalState = applyTransaction(
        { document: current.document, selection: current.selection || { type: "all" } },
        transaction,
      );
    }
    to.push({
      html: this.root.innerHTML,
      selection: current?.selection || null,
      canonical: entry.canonical,
      version: this.mutationVersion,
    });
    this.root.innerHTML = entry.html;
    this.mutationVersion += 1;
    if (entry.selection) restoreSelectionToDom(this.root, entry.selection);
    return entry;
  }

  historyStatus() {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
      canonicalUndo: this.undoStack.filter((entry) => entry.canonical).length,
      canonicalRedo: this.redoStack.filter((entry) => entry.canonical).length,
    };
  }

  execute<Input>(commandId: string, input?: Input): DomCommandResult | null {
    if (!this.root || this.readOnly) return null;
    const result = executeDomCommand({
      root: this.root,
      plugins: [...this.plugins],
      commandId,
      input,
    });
    if (!result) return null;
    this.emitLocalizedChange(commandId);
    return result;
  }

  executeBlockCommand(
    blocks: readonly HTMLElement[],
    command: DomBlockCommand,
  ): HTMLElement[] | null {
    if (!this.root || this.readOnly || blocks.some((block) => !this.root!.contains(block))) {
      return null;
    }
    const replacements = executeDomBlockCommand(blocks, command);
    if (!replacements) return null;
    this.emitLocalizedChange(command.id);
    return replacements;
  }

  executeChecklistItemCommand(
    list: HTMLElement,
    item: HTMLElement,
    checked?: boolean,
  ): HTMLElement | null {
    if (
      !this.root ||
      this.readOnly ||
      !this.root.contains(list) ||
      !list.contains(item)
    ) {
      return null;
    }
    const result = executeDomChecklistItemCommand(list, item, checked);
    if (!result) return null;
    this.emitLocalizedChange("checklist.set-checked");
    return result;
  }

  insertInlineImage(input: DomInlineImageInput): HTMLImageElement | null {
    if (!this.root || this.readOnly) return null;
    const image = executeDomInlineImageCommand(this.root, input);
    if (!image) return null;
    this.emitLocalizedChange("image.insert-inline");
    return image;
  }

  updateInlineImage(
    image: HTMLImageElement,
    input: Omit<DomInlineImageInput, "src">,
  ): boolean {
    if (!this.root || this.readOnly || !this.root.contains(image)) return false;
    if (!executeDomInlineImageUpdate(this.root, image, input)) return false;
    this.emitLocalizedChange("image.update-inline");
    return true;
  }

  insertFormula(input: DomFormulaInput): HTMLElement | null {
    if (!this.root || this.readOnly) return null;
    const formula = executeDomFormulaInsert(this.root, input);
    if (!formula) return null;
    this.emitLocalizedChange("formula.insert");
    return formula;
  }

  deleteInlineAtom(atom: HTMLElement): boolean {
    if (!this.root || this.readOnly || !this.root.contains(atom)) return false;
    const commandId = atom.hasAttribute("data-formula") ? "formula.delete" : "image.delete-inline";
    if (!executeDomInlineAtomDelete(this.root, atom)) return false;
    this.emitLocalizedChange(commandId);
    return true;
  }

  executeTableCommand(
    table: HTMLTableElement,
    command: DomTableCommand,
  ): HTMLTableElement | null {
    if (!this.root || this.readOnly || !this.root.contains(table)) return null;
    const replacement = executeDomTableCommand(table, command);
    if (!replacement) return null;
    this.emitLocalizedChange(command.id);
    return replacement;
  }

  insertTable(rows: number, columns: number, headerRow = false): HTMLTableElement | null {
    if (!this.root || this.readOnly) return null;
    const snapshot = this.snapshot();
    if (!snapshot?.selection || snapshot.selection.type !== "text") return null;
    const topLevelIndex = snapshot.selection.anchor.path[0];
    if (!Number.isInteger(topLevelIndex)) return null;
    const path = [Math.min(topLevelIndex + 1, snapshot.document.children.length)];
    const result = this.execute("table.insert", { path, rows, columns, headerRow });
    if (!result) return null;
    const candidate = this.root.children[path[0]];
    if (candidate instanceof HTMLTableElement) return candidate;
    return candidate?.querySelector("table") || null;
  }

  removeTable(table: HTMLTableElement): boolean {
    if (!this.root || this.readOnly || !this.root.contains(table)) return false;
    if (!executeDomTableRemoval(table)) return false;
    this.emitLocalizedChange("table.remove");
    return true;
  }

  replaceDocument(document: LegacySmartDocument, selection?: LegacySmartSelection) {
    if (!this.root || this.readOnly) return false;
    this.root.innerHTML = serializeSmartDocument(document);
    if (selection) restoreSelectionToDom(this.root, selection);
    return true;
  }

  subscribe(listener: DomEditorControllerListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitLocalizedChange(commandId: string) {
    const snapshot = this.snapshot();
    if (snapshot) {
      const latest = this.undoStack[this.undoStack.length - 1];
      if (latest?.version === this.mutationVersion) {
        this.promoteHistoryEntry(latest, snapshot, commandId);
      }
      this.mutationVersion += 1;
      this.listeners.forEach((listener) => listener({ commandId, snapshot }));
    }
  }

  private promoteHistoryEntry(
    entry: DomHistorySnapshot,
    after: DomEditorControllerSnapshot | null,
    commandId = "dom.canonical",
  ) {
    if (!this.root || !after || entry.canonical || entry.html === this.root.innerHTML) return;
    const beforeDocument = smartDocumentFromHtml(entry.html, this.root.ownerDocument);
    if (JSON.stringify(beforeDocument) === JSON.stringify(after.document)) return;
    const beforeSelection = entry.selection || { type: "all" as const };
    const afterSelection = after.selection || { type: "all" as const };
    const forward: LegacySmartTransaction = {
      id: commandId,
      source: "user",
      operations: [{ type: "replaceNode", path: [], node: after.document }],
      selectionBefore: beforeSelection,
      selectionAfter: afterSelection,
      addToHistory: true,
      timestamp: Date.now(),
    };
    entry.canonical = {
      forward,
      inverse: invertLegacyTransaction(
        { document: beforeDocument, selection: beforeSelection },
        forward,
      ),
    };
  }
}

export const createDomEditorController = () => new DomEditorController();
