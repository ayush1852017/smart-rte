import type { SmartCommand } from "./command.js";
import {
  applyTransactionWithHistory,
  createHistoryState,
  redoHistory,
  undoHistory,
  type SmartHistoryState,
} from "./history.js";
import type { LegacySmartDocument } from "./model.js";
import {
  createSmartSchema,
  normalizeSmartDocument,
  validateSmartDocument,
  type LegacySmartSchema,
} from "./schema.js";
import { orderPlugins, type SmartRtePlugin } from "./plugin.js";
import { applyTransaction, type SmartEditorState, type LegacySmartTransaction } from "./transaction.js";

export interface CreateSmartEditorOptions {
  state: SmartEditorState;
  plugins?: SmartRtePlugin[];
  historyLimit?: number;
  readOnly?: boolean;
}

export type SmartEditorListener = (
  state: SmartEditorState,
  transaction: LegacySmartTransaction
) => void;

const sameDocument = (left: LegacySmartDocument, right: LegacySmartDocument) =>
  JSON.stringify(left) === JSON.stringify(right);

export class SmartEditor {
  private currentState: SmartEditorState;
  private currentHistory: SmartHistoryState;
  private readonly plugins: SmartRtePlugin[];
  private readonly schema: LegacySmartSchema;
  private readonly commands = new Map<string, SmartCommand<any>>();
  private readonly listeners = new Set<SmartEditorListener>();
  private readOnly: boolean;

  constructor(options: CreateSmartEditorOptions) {
    this.plugins = orderPlugins(options.plugins || []);
    this.schema = createSmartSchema(this.plugins
      .filter((plugin) => plugin.schema)
      .map((plugin) => ({ id: plugin.id, ...plugin.schema })));
    const document = normalizeSmartDocument(options.state.document, this.schema);
    const validation = validateSmartDocument(document, this.schema);
    if (!validation.valid) throw new Error(`Initial document is invalid: ${validation.issues[0]?.message}`);
    this.currentState = { document, selection: options.state.selection };
    this.currentHistory = createHistoryState(options.historyLimit);
    this.readOnly = options.readOnly ?? false;
    this.plugins.forEach((plugin) => {
      Object.entries(plugin.commands || {}).forEach(([id, command]) => {
        if (this.commands.has(id)) throw new Error(`Duplicate command id "${id}".`);
        this.commands.set(id, command);
      });
    });
  }

  get state(): SmartEditorState {
    return this.currentState;
  }

  get history(): SmartHistoryState {
    return this.currentHistory;
  }

  get pluginIds(): string[] {
    return this.plugins.map((plugin) => plugin.id);
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
  }

  canExecute<Input>(id: string, input?: Input): boolean {
    if (this.readOnly) return false;
    const command = this.commands.get(id) as SmartCommand<Input> | undefined;
    return Boolean(command?.isEnabled(this.currentState, input));
  }

  execute<Input>(id: string, input?: Input): boolean {
    if (!this.canExecute(id, input)) return false;
    const command = this.commands.get(id) as SmartCommand<Input>;
    return this.dispatch(command.execute(this.currentState, input));
  }

  dispatch(transaction: LegacySmartTransaction): boolean {
    if (this.readOnly && transaction.source === "user") return false;
    const prepared = this.withPluginNormalization(transaction);
    const result = applyTransactionWithHistory(this.currentState, this.currentHistory, prepared);
    this.currentState = result.state;
    this.currentHistory = result.history;
    this.plugins.forEach((plugin) => plugin.onTransaction?.(prepared));
    this.listeners.forEach((listener) => listener(this.currentState, prepared));
    return true;
  }

  undo(): boolean {
    if (this.readOnly) return false;
    const result = undoHistory(this.currentState, this.currentHistory);
    if (!result.applied) return false;
    this.currentState = result.state;
    this.currentHistory = result.history;
    const transaction = result.history.redo[result.history.redo.length - 1]?.inverse;
    if (transaction) this.listeners.forEach((listener) => listener(this.currentState, transaction));
    return true;
  }

  redo(): boolean {
    if (this.readOnly) return false;
    const result = redoHistory(this.currentState, this.currentHistory);
    if (!result.applied) return false;
    this.currentState = result.state;
    this.currentHistory = result.history;
    const transaction = result.history.undo[result.history.undo.length - 1]?.forward;
    if (transaction) this.listeners.forEach((listener) => listener(this.currentState, transaction));
    return true;
  }

  subscribe(listener: SmartEditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private withPluginNormalization(transaction: LegacySmartTransaction): LegacySmartTransaction {
    const base = applyTransaction(this.currentState, transaction);
    let document = base.document;
    for (let pass = 0; pass < 10; pass += 1) {
      const beforePass = document;
      document = normalizeSmartDocument(document, this.schema);
      this.plugins.forEach((plugin) => {
        (plugin.normalizers || []).forEach((normalizer) => {
          document = normalizeSmartDocument(normalizer(document), this.schema);
        });
      });
      if (sameDocument(document, beforePass)) break;
      if (pass === 9) throw new Error("Plugin normalization did not reach a fixed point.");
    }
    const validation = validateSmartDocument(document, this.schema);
    if (!validation.valid) throw new Error(`Plugin normalization produced an invalid document: ${validation.issues[0]?.message}`);
    if (sameDocument(document, base.document)) return transaction;
    return {
      ...transaction,
      operations: [...transaction.operations, { type: "replaceNode", path: [], node: document }],
    };
  }
}

export const createSmartEditor = (options: CreateSmartEditorOptions) =>
  new SmartEditor(options);
