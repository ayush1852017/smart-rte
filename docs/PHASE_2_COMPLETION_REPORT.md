# Phase 2 Semantic Selection Framework completion report

> Historical Phase 2 exit snapshot. Phase 2.5 subsequently removed
> `SelectionDescription.storedMarks`, added `NodeSpec.semanticRole`, and added
> the read-only editor-local `ScopeIndex`/`PositionLookup`. The original findings
> below are retained to show what was true at the Phase 2 boundary; current
> contracts are in `SEMANTIC_SELECTION_CONTRACT.md` and the Phase 2.5 report.

## A. Implemented interfaces (verbatim)

```ts
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
```

Actual exported resolver signature:

```ts
export const resolveScope = (
  document: SmartDocument,
  selection: SmartSelection,
  request: ScopeRequest,
  schema: SmartSchema,
): ScopeResult => {
```

## B. Deviations from spec

### B1. Isolation clamps toward the normalized end, not original `selection.head`

- **Spec:** reverse selections must be byte-identical, while a crossing selection
  clamps to the side containing `selection.head`.
- **Built:** direction is normalized first and the clamp chooses the
  document-order `to` side. This is byte-identical after reversal.
- **Why:** reversing anchor/head changes the head, so the two specified rules are
  mutually impossible for an isolation-crossing selection. Gate 2 is an
  explicit stop condition; it was kept.
- **Reversal blast radius:** high. Returning to original-head clamping changes
  every crossing scope and invalidates the reverse-selection contract consumed
  by commands.

### B2. Container and list results expose `promotedFromPartial`

- **Spec:** universal rule 5 says block/container/list promotion must record that
  promotion happened, but the sample container/list interfaces did not contain
  the field.
- **Built:** `ContainerTreeScope` and `ListSelectionScope` each add
  `promotedFromPartial: boolean`.
- **Why:** otherwise the mandated promotion is silent.
- **Reversal blast radius:** low now; high after commands begin inferring the
  missing fact independently.

### B3. `list-selection` can return block or mixed structure

- **Spec:** `mixed` must enumerate every structural unit and resolvers must not
  hide structure. The sample `ListSelectionScope` alone cannot represent a
  selection containing both list items and plain blocks.
- **Built:** plain-block input resolves to `BlockRangeScope`; list plus plain
  blocks resolves to `MixedScope` containing list and block parts. Nested items
  group under the selected outer list and carry relative depth.
- **Why:** a Phase 3 list command must not run a second resolver and reinterpret
  the missing plain blocks.
- **Reversal blast radius:** medium. Narrowing this later would simplify the
  result but push scope policy into every list command.

### B4. Individual resolvers are internal

- **Spec:** names six individual resolvers in an implementation order.
- **Built:** all six exist, but the scope runtime exports only `resolveScope` and
  types.
- **Why:** one total entry point prevents callers bypassing shared normalization
  and isolation clamping; it also proves gate 12 mechanically.
- **Reversal blast radius:** low. They can be exported later, but doing so would
  create an alternate contract that accepts internal resolution context.

### B5. Semantic containers use conventional schema type names

- **Spec:** gives `SmartSchema`, but `NodeSpec` has no semantic role for list,
  list-item, table, row, or cell.
- **Built:** resolution recognizes the frozen names `list`, `list_item`,
  `table`, `table_row`, `table_cell`, and documented spelling aliases.
- **Why:** adding semantic roles would renegotiate the frozen Phase 1 schema.
- **Reversal blast radius:** internally low because scope results remain ID-based;
  ecosystem blast radius is medium if plugins expect arbitrary type names.

## C. Locked decisions

- **Clamping direction:** normalized document-order end (`range.to`). This is
  direction-independent. The innermost isolating ancestor at that endpoint is
  selected. A same-table `table-grid` may cross sibling cell isolations and is
  contained by the table isolation.
- **Boundary endpoints:** an endpoint at offset 0 of the next block excludes that
  block; an endpoint at a block's end includes it. Empty and collapsed blocks
  resolve to their containing block.
- **Promotion:** inline ranges remain partial. Block, container, and list scopes
  promote touched text to complete structural units and expose
  `promotedFromPartial`. Table requests promote to logical cells. Atomic requests
  require exact atom coverage.
- **Atom versus inline run:** an inline atom is one unit. Exact atom coverage with
  `atomic-node` returns `AtomicNodeScope`; `inline-range` returns its owner run
  with `containsAtoms: true`. Block atoms are both atomic nodes and complete
  blocks.
- **`commonParentId`:** the shared direct parent ID when every returned block has
  that parent; otherwise `null`.
- **Non-rectangular grids:** never expanded or repaired. The bounding logical
  rectangle is reported, external span anchors appear in `coveredCellIds`, and
  incomplete occupancy is `rectangular: false`.
- **Collapsed inline:** one zero-width run and `storedMarkAnchor`.
- **Collapsed block:** the containing complete block.
- **Collapsed container:** the containing block, promoted to a common `stopAt`
  ancestor when requested.
- **Collapsed list:** nearest item/list; outside a list, the containing plain
  block is reported structurally.
- **Collapsed table:** the containing logical cell.
- **Collapsed atomic:** empty, because a caret covers no atom. Node selections
  use exact before/after boundaries.
- **Collapsed describe:** `collapsed: true`, with structural context at the
  normalized position.

## D. Exit gate results

| # | Result | Machine verification |
|---|---|---|
| 1 | **Pass** | `packages/core/src/foundation/scope/scope.test.ts`: total request matrix plus list/table/atom/mixed/empty fixtures. |
| 2 | **Pass** | Same file: 2,500 generated cases across a 16-document paragraph/atom/list/table corpus, seed `0x5C0FE202`. Every request is JSON-byte-compared with its reverse. |
| 3 | **Pass** | Same file: every request resolves repeatedly against a deeply frozen table document without mutation. |
| 4 | **Pass** | Same file: cell-to-outside, sibling cells, outside-to-cell, nested isolation, and nested-table matrices assert the clamp and reason. Same-table grid crossing is the specified grid exception. |
| 5 | **Pass** | Same file: atom start/end/interleaving, exact inline/block selection, invalid atom-internal position rejection, and independent per-text-child grapheme boundaries. |
| 6 | **Pass** | Same file: offset 0, end offset, collapsed start/end/empty, and exact full-block matrix. |
| 7 | **Pass** | Same file: collapsed universal matrix plus non-empty inline/block/container/list/table fixtures and atomic empty behavior. |
| 8 | **Pass** | Same file: rowspan occupancy, logical rectangles, selected cells, external covered span anchors, and `rectangular: false` fixture. |
| 9 | **Pass** | `scripts/check-scope-contract.mjs`: ID-only API gate; scope type review contains no structural path fields. |
| 10 | **Pass** | `scope.test.ts`: clamped block result is compared with unclamped `describe.spansIsolatingBoundary`. |
| 11 | **Pass** | `scripts/check-scope-contract.mjs`: raw anchor/head field branching is rejected and the shared resolved-kind boundary is required. |
| 12 | **Pass** | `scripts/check-scope-contract.mjs`: only the read-only `resolveScope` runtime is exported; mutation-shaped exports fail lint. |

No exit gate is verified only by hand. The full repository check passed with
260 core tests and 210 React tests. Existing React ClassicEditor list tests
still emit `act(...)` warnings, but none failed.

## E. Known gaps and TODOs

1. **Stored marks cannot be described.** `SelectionDescription.storedMarks` is
   present but never populated because the specified resolver inputs contain no
   stored-mark state. A collapsed selection's `storedMarkAnchor` is populated;
   actual stored marks require a Phase 2.5 input/state contract decision.
2. **`stopAt` purity is caller-enforced.** The spec puts an arbitrary function in
   `ScopeRequest`; no runtime can prove that the closure does not read time or
   mutable external state. Determinism is guaranteed for pure predicates and is
   tested with pure predicates.
3. **Semantic roles are name-based.** A schema using `ordered_collection`
   instead of `list` is structurally valid but will not receive list semantics.
   There is no frozen `NodeSpec.semanticRole` extension point.
4. **Every call builds an ephemeral full-document index.** It does not clone or
   mutate, but collapsed and small local selections still traverse the model.
   The public contract permits a persistent/read-only index later.
5. **Malformed overlapping table spans are not repaired.** Valid rowspan/colspan
   grids are handled. Overlapping spans are reported from the constructed
   occupancy grid, but schema validation currently has no document-wide table
   geometry invariant.
6. **Mixed child scopes retain the normalized outer range.** Their ID lists are
   exact, but each child `ScopeBase.range` is not narrowed to its individual
   part. Commands are specified to consume IDs and re-resolve positions; I am
   not fully confident that diagnostics will not eventually want per-part
   ranges.

## F. Performance observations

Local Node benchmark, three warmups, median/min/max in milliseconds. Full block
range uses N paragraph blocks; table grid uses N logical cells in ten columns.

| Units | Full-document block range | Large table grid |
|---:|---:|---:|
| 500 | 0.327 / 0.241 / 1.008 ms | 0.826 / 0.647 / 1.997 ms |
| 2,000 | 1.111 / 0.864 / 1.789 ms | 4.054 / 2.881 / 11.152 ms |
| 10,000 | 6.021 / 5.548 / 8.809 ms | 21.132 / 17.661 / 29.997 ms |

The curve is cheaply linear, not sub-linear. Resolution performs no
`structuredClone`, but it does traverse the complete document once to build the
ephemeral index. Large grid work also builds logical occupancy, explaining the
higher slope. Reproduce with `pnpm run benchmark:phase2`.

## G. Open questions blocking Phase 2.5 or Phase 3

1. **Stored-mark input:** should Phase 2.5 pass stored marks separately to a
   describe helper, expand `ScopeRequest`, or keep toolbar state outside this
   pure four-argument function? The current signature cannot return them.
2. **Confirm normalized-end clamping:** Phase 3 commands should not be built until
   the resolution of the head-clamp/reverse-symmetry contradiction in B1 is
   accepted as frozen.
3. **Semantic role extension:** Phase 3 is safe with the frozen `list` and
   `list_item` names. Before third-party structural schemas or Phase 6 tables,
   decide whether conventional type names are permanent or whether a separate
   immutable semantic-role registry is needed.
4. **ID-to-position lookup:** scopes intentionally return IDs. Phase 3 commands
   will need one shared read-only ID lookup at use time; they must not each
   invent their own traversal or cache stale paths.

For list commands specifically, selection of nested items, partial subtrees,
plain blocks, and mixed list/plain structure is explicit. No list command needs
to guess those semantics.

## H. Scope leakage

No command, mutation, input event handling, toolbar wiring, clipboard adapter,
shadow mode, plugin runtime, feature migration, or root-contract promotion was
implemented. The only adjacent addition is the read-only
`inlineGraphemeBoundaries` position utility needed to prove that grapheme
segmentation stops at atom boundaries. Benchmark, documentation, tests, and
lint gates are verification infrastructure, not feature/runtime leakage.
