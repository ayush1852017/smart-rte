export type NodeGroup = "document" | "block" | "inline";
export type Attrs = Readonly<Record<string, unknown>>;

export interface AttributeSpec {
  default?: unknown;
  required?: boolean;
  validate?: (value: unknown) => boolean;
}

export interface NodeSpec {
  type: string;
  group: NodeGroup;
  content?: string;
  marks?: string[] | "_all" | "";
  attributes?: Record<string, AttributeSpec>;
  atomic?: boolean;
  isolating?: boolean;
  selectable?: boolean;
  defining?: boolean;
  /** Structural role for scope resolution. Falls back to `type` when absent. */
  semanticRole?: "list" | "list-item" | "table" | "table-row" | "table-cell";
}

export interface MarkSpec {
  type: string;
  attributes?: Record<string, AttributeSpec>;
  inclusive?: boolean;
  excludes?: string[];
  spanning?: boolean;
}

export interface SmartSchema {
  readonly nodes: Readonly<Record<string, Readonly<NodeSpec>>>;
  readonly marks: Readonly<Record<string, Readonly<MarkSpec>>>;
  readonly topNode: string;
  readonly version: number;
}

export interface SmartMark {
  readonly type: string;
  readonly attrs?: Attrs;
}

export interface SmartTextNode {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly SmartMark[];
}

export interface SmartElementNode {
  readonly type: string;
  readonly id: string;
  readonly attrs?: Attrs;
  readonly children?: readonly SmartNode[];
}

export type SmartNode = SmartTextNode | SmartElementNode;

export interface SmartDocument extends SmartElementNode {
  readonly type: "doc";
  readonly children: readonly SmartNode[];
}

export interface PersistedEditorDocument {
  schemaVersion: number;
  revision: number;
  document: SmartDocument;
}

export interface SmartPos {
  /**
   * Path of the owning non-text node. Offset meaning is resolved from that
   * node's schema role: UTF-16 units for an inline-content owner, child
   * boundaries for a structural owner. Inline atomic children occupy exactly
   * one UTF-16-offset unit and have no internal cursor positions.
   *
   * This is intentionally not a stored discriminated union: a stored kind
   * could disagree with the schema after version skew. `ResolvedPos.kind` is
   * the authoritative, schema-derived discriminant consumed by commands.
   */
  path: number[];
  offset: number;
}

export interface ResolvedPos {
  pos: SmartPos;
  kind: "inline" | "structural";
  nodeId: string;
  parent: SmartElementNode;
  depth: number;
  affinity: "forward" | "backward";
  ancestors: readonly SmartElementNode[];
  nodeBefore: SmartNode | null;
  nodeAfter: SmartNode | null;
  atStart: boolean;
  atEnd: boolean;
  indexAt(depth: number): number;
}

export interface SmartRange {
  from: SmartPos;
  to: SmartPos;
}

export interface SmartSelection {
  anchor: SmartPos;
  head: SmartPos;
  type: "text" | "node" | "cell" | "none";
}

export type SmartOperation =
  | { type: "insertNode"; pos: SmartPos; node: SmartNode }
  | { type: "removeNode"; pos: SmartPos; node: SmartNode }
  | { type: "replaceNode"; pos: SmartPos; before: SmartNode; after: SmartNode }
  | { type: "moveNode"; from: SmartPos; to: SmartPos; nodeId: string }
  | { type: "splitNode"; pos: SmartPos; depth: number; newId: string }
  | { type: "mergeNode"; pos: SmartPos; depth: number; retiredId: string; splitOffset: number }
  | { type: "setNodeAttributes"; pos: SmartPos; before: Attrs; after: Attrs }
  | { type: "insertText"; pos: SmartPos; text: string; marks?: SmartMark[] }
  | { type: "deleteText"; pos: SmartPos; text: string; marks?: SmartMark[] }
  | { type: "addMark"; range: SmartRange; mark: SmartMark }
  | { type: "removeMark"; range: SmartRange; mark: SmartMark };

export interface SmartTransaction {
  id: string;
  baseRevision: number;
  operations: SmartOperation[];
  selectionBefore: SmartSelection;
  selectionAfter: SmartSelection;
  storedMarksBefore?: SmartMark[];
  storedMarksAfter?: SmartMark[];
  metadata: {
    source: "input" | "keyboard" | "toolbar" | "paste" | "drop" | "api";
    timestamp: number;
    historyGroup?: string;
    addToHistory: boolean;
    compositionId?: string;
    authorId?: string;
  };
}

export interface TransactionMap {
  map(pos: SmartPos, bias?: -1 | 1): SmartPos;
  mapRange(range: SmartRange): SmartRange;
  mapSelection(selection: SmartSelection): SmartSelection;
  deleted(pos: SmartPos): boolean;
}

export interface NormalizerContext {
  readonly schema: SmartSchema;
  readonly affectedPath: readonly number[];
  readonly pass: number;
  readonly documentWide: boolean;
}

export interface NormalizerResult {
  operations: SmartOperation[];
}

export interface NormalizerRegistration {
  id: string;
  priority: number;
  documentWide?: boolean;
  normalize(document: SmartDocument, context: NormalizerContext): NormalizerResult;
}

export interface HistoryEntry {
  forward: SmartTransaction;
  inverse: SmartTransaction;
  estimatedBytes: number;
}

export interface SmartHistory {
  readonly undo: readonly HistoryEntry[];
  readonly redo: readonly HistoryEntry[];
  readonly limit: number;
  readonly coalescenceWindowMs: number;
}

export interface ModelDomMapping {
  nodeToDom(nodeId: string): HTMLElement | null;
  domToNode(el: Node): { nodeId: string; node: SmartNode } | null;
  posToDom(pos: SmartPos): { node: Node; offset: number } | null;
  domToPos(node: Node, offset: number): SmartPos | null;
  isEditorUiNode(el: Node): boolean;
  rebuild(root: HTMLElement, document: SmartDocument): void;
}

export interface ValidationError {
  path: number[];
  code: string;
  message: string;
}

export interface Repair {
  path: number[];
  code: string;
  message: string;
  before?: unknown;
  after?: unknown;
}
