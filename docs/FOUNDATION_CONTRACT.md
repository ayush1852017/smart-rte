# Phase 1 Foundation Contract

The C0 kernel is published from `smartrte-core/foundation`. It deliberately
coexists with the legacy root export while feature migration is out of scope.
All Phase 2 work must target the foundation subpath rather than the legacy
path-based editor contracts.

## Locked model decisions

- Content expressions use ProseMirror-style names, groups, sequences, choices,
  parentheses, and `*`, `+`, and `?` quantifiers.
- Unknown nodes are preserved as atomic, isolating, non-editable `unknown`
  nodes. Their attributes contain `originalType`, `originalGroup`, the complete
  JSON-compatible `raw` node, and `editable: false`.
- `validate` is pure. `repair` is explicit and returns both the repaired
  document and a repair log. Transaction-time schema repairs are encoded as
  operations appended to the originating transaction.
- An empty paragraph or heading has `children: []`; it does not contain a
  zero-length text node. An empty document contains one empty paragraph. An
  empty list contains one list item, and an empty list item contains one empty
  paragraph. When table specs are registered, an empty table cell must contain
  one empty paragraph.
- Every non-text node—including the document root and inline atoms—has a stable
  UUID. Text nodes and marks do not have IDs.
- Split keeps the first/original node ID and assigns `newId` to the second.
  Merge keeps the left node ID and retires the right. Move preserves ID. Undo
  restores the exact retired IDs from operation payloads.
- IDs are part of persisted JSON and renderer DOM as `data-smart-id`. A future
  clean-HTML adapter may strip them; the canonical representation does not.
- Schema contributions collide loudly and the constructed schema is frozen.
- `NodeSpec.semanticRole` identifies list and table structure independently of
  plugin-chosen type names. Scope resolution prefers it and falls back to the
  conventional built-in type name through one shared `roleOf` helper.

## Locked position and selection decisions

- A `SmartPos.path` addresses its owning non-text node. For paragraphs and
  headings, `offset` is a UTF-16 offset through inline content, with atomic
  inline nodes counting as exactly one indivisible unit (the model equivalent
  of U+FFFC). There are positions immediately before and after an atom and no
  position inside it. For structural containers, `offset` is a child boundary.
- Stored `SmartPos` deliberately has no redundant kind field: the node at its
  path is authoritative and a persisted discriminant could disagree after
  schema/version skew. `ResolvedPos.kind` is the required `"inline" |
  "structural"` discriminant consumed by commands and resolvers.
- Commands use `ResolvedPos` and `SmartRange`; raw paths remain serialized
  operation data only.
- Default affinity is `backward`.
- Selection stores direction-preserving `anchor` and `head`; normalized
  `from`/`to` exists only as `SmartRange`.
- Core text order is logical, including bidi text. Visual movement belongs to
  the renderer/input layer.
- Offsets match DOM UTF-16 offsets, but movement and backspace use
  `Intl.Segmenter` grapheme boundaries.

## Locked transaction and normalization decisions

- Every operation carries enough prior data for `invert(op)` to be pure.
  `mergeNode.splitOffset` and `deleteText.marks` are required additions to the
  original draft union because the draft could not otherwise invert itself.
- Stale transactions throw. Phase 1 never silently rebases.
- Nested `editor.transact()` calls share one builder and commit once. Returning
  a Promise is rejected; async work must finish before opening a transaction.
- Selection-only transactions have no operations and default to
  `addToHistory: false`.
- Transaction values are plain JSON data and are checked for serializability.
- Insertion mapping bias defaults to `+1`: a position exactly at inserted
  content moves after it. `-1` keeps it before.
- Deleted positions map to the nearest surviving parent boundary and remain
  queryable through `TransactionMap.deleted`.
- Normalization is deterministic, idempotent, terminating, and scoped to the
  smallest affected ancestor unless a document-wide invariant requires
  otherwise.
- Schema repair runs before registered normalizers. Normalizer priority sorts
  ascending; registration order breaks ties. The hard pass cap is 3.
  Document-wide normalizers must opt in and are counted/reported.
- Normalization operations join the originating transaction.

## Locked history and DOM decisions

- Typing coalesces when source is `input`, insertion positions are contiguous,
  selections connect exactly, and timestamps are no more than 400 ms apart.
- Transactions sharing a `compositionId` form one IME undo step regardless of
  their timestamps.
- Undo restores `selectionBefore`; redo restores `selectionAfter`, preserving
  anchor/head direction.
- History is capped at 200 entries and evicts the oldest entry first. New
  recorded input clears redo. `addToHistory: false` is never recorded.
- Renderer-only DOM uses `data-smart-ui`; such nodes are skipped in both mapping
  directions and never enter the model.
- The Phase 1 naive renderer remains available for mapping fixtures. The Phase
  2.5 canonical surface uses contentEditable plus reference-keyed subtree
  diffing, restores selection after writes, and never writes the composing
  owner until composition ends. Destructive editable DOM virtualization remains
  out of scope.
- DOM mappings can be rebuilt from the model and rendered DOM.

## Authority boundary and promotion trigger

- `smartrte-core/foundation` is the only authority for new model, selection,
  operation, and transaction work. The legacy root contracts are frozen
  compatibility code.
- `pnpm run lint:foundation-boundary` enforces this. New source files cannot
  import `SmartSelection`, `SmartOperation`, or `SmartTransaction` from the
  package root; only the five snapshot-listed legacy React bridge files may do
  so. Foundation code cannot import upward into legacy core modules.
- Root promotion is a Phase 3 list-migration exit criterion: once lists are the
  first legacy feature running on the foundation kernel, the root names must
  re-export the foundation contracts and the legacy types must be renamed or
  removed. Phase 3 is not complete while both authorities retain the same
  public names.

## Mutation rule

Canonical model values are immutable. Code must never mutate a node, its attrs,
marks, or children in place; every change is an operation producing new model
values. Foundation node fields and child/mark arrays are readonly in TypeScript,
and the operation algebra suite runs every operation against deeply frozen
input. Operation application path-copies the edited root-to-node path. Untouched
subtrees retain reference identity; `same reference => unchanged subtree` is a
memoization contract used by the scope index and renderer.

## Input-pipeline placement

Phase 1 proves canonical typing transactions and IME history grouping in the
kernel; it does not prove browser `beforeinput` or composition behavior. The
real browser input pipeline is the standalone Phase 2.5 canonical surface. Its
synthetic composition paths are covered in Chromium, Firefox, and WebKit;
physical-device Android and platform IME validation remains required before
claiming device-level compatibility.
