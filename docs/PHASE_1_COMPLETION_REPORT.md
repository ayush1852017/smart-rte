# Phase 1 Foundation Contract completion report

Snapshot: 2026-08-02. Foundation entry point: `smartrte-core/foundation`.

## A. Implemented interfaces (verbatim)

The following is copied from `packages/core/src/foundation/types.ts`.

```ts
export type NodeGroup = "document" | "block" | "inline";
export type Attrs = Record<string, unknown>;

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
```

## B. Deviations from spec

| Spec | Implementation | Reason | Reversal blast radius |
| --- | --- | --- | --- |
| The new names implicitly replace the existing core contracts. | The C0 kernel is an isolated public `smartrte-core/foundation` subpath; the legacy root exports remain unchanged. | Replacing root `SmartSelection`, `SmartOperation`, and `SmartTransaction` would migrate existing list/table/media features and React bridges, explicitly excluded in Phase 1. | High. Root promotion later requires migrating legacy consumers. Phase 2 must use only the foundation subpath to avoid increasing that radius. |
| `mergeNode` has only `retiredId`. | Added required `splitOffset`. | Pure `invert(merge)` cannot reconstruct the split boundary from the draft payload. | Low to keep; high if removed because inversion would require a document lookup. |
| `deleteText` has only deleted text. | Added optional deleted `marks`. | Pure inversion cannot restore marked text without retaining marks. | Low to keep; high if removed for the same reason. |
| `ModelDomMapping` lists five methods and says reconstruction must be possible. | Added `rebuild(root, document)` to the interface. | Makes the reconstruction requirement explicit and testable. | Low. |
| Normalizer registration shape was not specified. | Normalizers return operations, not replacement documents. | Enforces operations as the only transaction mutation path and lets repairs join history. | Medium; changing it would affect every future normalizer. |
| Node/spec maps were mutable in the draft interface. | `SmartSchema` exposes readonly maps/specs and freezes them at construction. | Enforces the stated schema immutability invariant. | Low. |
| ID recommendation was all block and atomic nodes. | Every non-text node, including doc, list items, and non-atomic containers, receives an ID. | Stable owning identity is useful throughout position resolution and annotations; text remains ID-less. | Medium memory cost; removing IDs later would break references. |
| Position storage semantics were not explicit about what `path` owns. | A path addresses the owning non-text node. Inline offsets are linear UTF-16 offsets, atoms occupy exactly one unit, structural offsets are child boundaries, and `ResolvedPos.kind` is the derived discriminant. | Avoids unstable text-node paths and avoids a stored discriminant that could contradict the schema after version skew. | High. This is intentionally locked now. |

## C. Locked decisions

- Content expressions: ProseMirror-style names/groups, sequence, choice,
  parentheses, `*`, `+`, and `?`.
- Unknown nodes: atomic/isolating/selectable `unknown` with
  `{ originalType, originalGroup, raw, editable: false }`.
- Empty content: paragraph/heading `children: []`; empty doc → one empty
  paragraph; empty list → one empty list item; empty list item → one empty
  paragraph; future empty table cell → one empty paragraph.
- IDs: every non-text node; UUIDv4 from Web Crypto. No insecure fallback.
- Split/merge/move/undo IDs: first split half keeps ID; second uses `newId`;
  left merged node survives; right `retiredId` is restored by undo; move keeps ID.
- Affinity: `backward` default.
- Inline atoms: exactly one indivisible offset unit, with positions before and
  after but never inside. `ResolvedPos.kind` is the schema-derived inline vs.
  structural discriminant; stored `SmartPos` does not duplicate that fact.
- Selection: direction-preserving anchor/head storage.
- Graphemes: UTF-16 storage with `Intl.Segmenter` movement/deletion; logical bidi
  order in core.
- Stale transaction: throws `StaleTransactionError`.
- Nesting: one shared synchronous `TransactionBuilder`; Promise-returning
  callbacks throw.
- Selection-only history: zero operations, `addToHistory: false` by default.
- Normalizers: schema repair first; ascending integer priority; registration
  order tie-break; pass cap 3; explicit `documentWide`; smallest common operation
  ancestor for local runs; repair operations append to the original transaction.
- Typing coalescence: input source, contiguous insert positions, exact selection
  continuity, and ≤400 ms; equal `compositionId` overrides time grouping.
- History cap: 200 entries, oldest-first eviction.
- Editor UI marker: `data-smart-ui`; model identity marker: `data-smart-id`.
- Mapping bias: default `+1` moves a boundary position after inserted content;
  `-1` keeps it before. Deleted content maps to its nearest surviving boundary
  and reports `deleted: true`.

## D. Invariant test results

| # | Result | Proof |
| --- | --- | --- |
| 1 | Pass | `packages/core/src/foundation/foundation.test.ts`: schema validation, explicit repair, five-cycle unknown/persisted round-trip, malformed MVP repair. |
| 2 | Pass | Same file: 500 randomized structural sequences, seed `0x1D5`, exact structure and ID list after full inversion. |
| 3 | Pass for the foundation API; legacy root intentionally remains | `TransactionBuilder` accepts `ResolvedPos`/`SmartRange`; TypeScript lint passes. `pnpm run lint:foundation-boundary` rejects new imports of the three legacy contracts outside five frozen compatibility files. Raw `number[]` remains only inside `SmartPos`, repair diagnostics, and normalizer context. |
| 4 | Pass | Same file: Devanagari, Tamil, Telugu conjunct, emoji ZWJ, combining-diacritic, and RTL logical-run fixtures for movement/backspace. |
| 5 | Pass | Same file: all 11 operation types individually; 1,000 randomized text sequences seed `0xC0FFEE`; 500 structural sequences seed `0x1D5`. |
| 6 | Pass | Same file: stale revision throw and a two-op failure-atomic transaction leaves input byte-identical. |
| 7 | Pass | Same file: mapped positions remain resolvable through every operation type; 1,000 associativity cases seed `0xA550C`; deleted-position assertion. |
| 8 | Pass | Same file: 1,000 deterministic idempotence inputs seed label `0xA0`, priority/locality assertions, three-pass named oscillator failure, and zero full-document normalization traversals on typing. |
| 9 | Pass | Same file: 50-character coalescence, exact undo/redo cursor restoration, direction-preserving selection, redo invalidation, and multi-event IME composition as one step. Automated; no manual-only gate. |
| 10 | Pass | `packages/react/src/adapters/foundationModelDom.test.ts`: text, atomic, and block-boundary round-trips plus UI skipping and rebuild. |
| 11 | Pass | `rg "document\\.execCommand" packages/core` returned no matches. Grep gate, not a runtime test. |
| 12 | Pass | Foundation test calls `assertTransactionSerializable`; all history/transaction tests also exercise structured cloning and JSON byte estimates. |

Full regression result: core 25 files/247 tests passed; React 31 files/210 tests
passed. Core and React build and TypeScript lint commands passed. Existing React
tests still emit pre-existing `act(...)` warnings in list tests; they do not fail.
The Playwright browser suite also passed all 23 workflows.

## E. Known gaps and TODOs

- The legacy root core API still exposes raw `Path`-based commands. This is an
  intentional compatibility island, not part of the frozen foundation API.
  Consequence: Phase 2 code must import `smartrte-core/foundation`; adding new
  work to the root contracts would deepen migration debt.
- The dual-authority period has a deadline: root promotion is a Phase 3
  list-migration exit criterion. The boundary lint prevents new consumers while
  the five existing React compatibility files remain allowlisted.
- Structural schema repair currently discovers repairs by traversing the full
  document, then emits a replacement at the smallest representable affected
  node. Ordinary text/mark input skips that traversal entirely. Consequence:
  malformed structural edits are correct and undoable but not yet optimized for
  very large documents.
- `applyOperation` uses immutable `structuredClone` at the document boundary.
  It is correct but clones more than a production persistent-tree
  implementation should. The measured cost is recorded below.
- Canonical node fields and arrays are readonly and every operation is exercised
  against deeply frozen input. In-place mutation is prohibited now, before a
  persistent-tree implementation removes the protective clone.
- The mapping implementation is deliberately a naive renderer. It does not
  perform DOM diffing, preserve a live native selection across rerenders, or
  benchmark `content-visibility`; those are explicit later concerns.
- Mark exclusion is validated/repaired by schema normalization. Operation-level
  `addMark` does not itself consult a schema, so callers applying operations
  outside transactions can temporarily create invalid content before explicit
  validation/normalization.
- `Intl.Segmenter` and Web Crypto are runtime requirements. There is no fallback
  because a hand-rolled grapheme splitter or weak ID generator would violate
  the contract.
- Canonical JSON and rendered DOM preserve IDs. A future clean-HTML adapter that
  strips `data-smart-id` is not implemented because clipboard/export adapters
  are out of scope.

## F. Performance observations

Measured in Node 24 after five warmups, using 200 UTF-16 characters per block
and 50 consecutive single-character samples at each size:

| Blocks | Characters | Average | Median | p95 | Max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 100,000 | 1.91 ms | 1.88 ms | 2.14 ms | 2.35 ms |
| 2,000 | 400,000 | 7.24 ms | 7.17 ms | 7.55 ms | 8.07 ms |
| 10,000 | 2,000,000 | 38.90 ms | 38.75 ms | 40.28 ms | 41.90 ms |

At every size, normalization affected path was `[0]` and reported zero
full-document normalization traversals during ordinary input.

The apply path still clones the complete immutable document; therefore “zero
full-document traversal” applies specifically to normalization, not total CPU
work. That distinction should not be hidden. The curve is approximately linear
and crosses a 16.7 ms frame well before 10,000 blocks. If 10,000-block documents
are supported, the persistent-tree swap should happen in Phase 2.5 before list
migration, not after Phase 3.

## G. Open questions blocking Phase 2

No unresolved position, selection, or transaction ambiguity blocks Phase 2 if
Phase 2 imports only `smartrte-core/foundation`.

Phase 2 must consume the locked owning-node position semantics and must not
reinterpret inline paths as text-node paths. It must also decide semantic scope
without bypassing `isolating` nodes, but that is Phase 2 behavior rather than an
unresolved Phase 1 contract.

Promoting these contracts onto the legacy package root is intentionally not a
Phase 2 prerequisite; routing existing features through them remains later
migration work.

The browser input pipeline is explicitly assigned to Phase 2.5, after semantic
scope resolution and before list migration. Current IME tests prove grouping
logic only; they do not claim Chrome/Safari composition correctness.

## H. Scope leakage

No feature migration, toolbar routing, semantic scope resolver, shadow-mode
infrastructure, plugin runtime/manifest, clipboard adapter, structural list
history, or ClassicEditor deletion was implemented.

The only React-side addition is a jsdom contract test for the allowed naive
Model↔DOM mapper. The renderer itself lives in the core foundation submodule and
is correctness-only, as Phase 1 requested.
