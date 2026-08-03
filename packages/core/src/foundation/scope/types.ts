import type {
  ResolvedPos,
  SmartDocument,
  SmartMark,
  SmartNode,
  SmartRange,
  SmartSchema,
  SmartSelection,
} from "../types.js";

export type ScopeRequest =
  | { want: "inline-range" }
  | { want: "block-range" }
  | { want: "container-tree"; stopAt?: (node: SmartNode) => boolean }
  | { want: "list-selection" }
  | { want: "table-grid" }
  | { want: "atomic-node" }
  | { want: "describe" };

export type ScopeKind =
  | "inline-range"
  | "block-range"
  | "container-tree"
  | "list-selection"
  | "table-grid"
  | "atomic-node"
  | "mixed"
  | "empty";

export interface ScopeBase {
  kind: ScopeKind;
  /** Normalized, direction-independent. Always from <= to. */
  range: SmartRange;
  /** Nearest isolating ancestor fully containing this scope, if any. */
  isolatingAncestorId: string | null;
  /** True when the request could not be satisfied exactly and was clamped. */
  clamped: boolean;
  /** Why it was clamped — isolating boundary, atom boundary, document edge. */
  clampReason?: "isolating" | "atomic" | "document-edge" | "schema";
}

export interface InlineRun {
  ownerNodeId: string;
  from: number;
  to: number;
  containsAtoms: boolean;
}

export interface InlineRangeScope extends ScopeBase {
  kind: "inline-range";
  runs: InlineRun[];
  collapsed: boolean;
  storedMarkAnchor?: ResolvedPos;
}

export interface BlockRangeScope extends ScopeBase {
  kind: "block-range";
  blockIds: string[];
  promotedFromPartial: boolean;
  commonParentId: string | null;
}

export interface ContainerTreeScope extends ScopeBase {
  kind: "container-tree";
  rootId: string;
  nodeIds: string[];
  promotedFromPartial: boolean;
}

export interface ListSelectionScope extends ScopeBase {
  kind: "list-selection";
  listId: string;
  items: { itemId: string; depth: number; hasChildList: boolean }[];
  partialSubtree: boolean;
  promotedFromPartial: boolean;
}

export interface TableGridScope extends ScopeBase {
  kind: "table-grid";
  tableId: string;
  rect: { top: number; left: number; bottom: number; right: number };
  cellIds: string[];
  coveredCellIds: string[];
  rectangular: boolean;
}

export interface AtomicNodeScope extends ScopeBase {
  kind: "atomic-node";
  nodeId: string;
  inline: boolean;
}

export interface MixedScope extends ScopeBase {
  kind: "mixed";
  parts: ResolvedScope[];
}

export interface EmptyScope extends ScopeBase {
  kind: "empty";
}

export type ResolvedScope =
  | InlineRangeScope
  | BlockRangeScope
  | ContainerTreeScope
  | ListSelectionScope
  | TableGridScope
  | AtomicNodeScope
  | MixedScope
  | EmptyScope;

export interface SelectionDescription {
  blockTypes: string[];
  marks: { mark: SmartMark; coverage: "all" | "partial" }[];
  inList: { listId: string; depth: number } | null;
  inTable: { tableId: string; cellId: string } | null;
  isolatingAncestorId: string | null;
  atoms: string[];
  collapsed: boolean;
  spansIsolatingBoundary: boolean;
}

export type ScopeResult = ResolvedScope | SelectionDescription;

export interface PositionLookup {
  positionOf(nodeId: string): ResolvedPos | null;
  rangeOf(nodeId: string): SmartRange | null;
  contentRangeOf(nodeId: string): SmartRange | null;
  exists(nodeId: string): boolean;
}

export interface ScopeIndex {
  resolve(document: SmartDocument, selection: SmartSelection, request: ScopeRequest, schema: SmartSchema): ScopeResult;
  positions(document: SmartDocument, schema: SmartSchema): PositionLookup;
  readonly liveNodeCount: number;
}

export type ResolveScope = (
  document: SmartDocument,
  selection: SmartSelection,
  request: ScopeRequest,
  schema: SmartSchema,
) => ScopeResult;
