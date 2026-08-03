# Smart RTE Semantic Selection Contract

Phase 2 is exported from `smartrte-core/foundation`. It is a read-only model
query surface. Callers may use the stateless `resolveScope(...)` function or an
editor-local `ScopeIndex`, whose `PositionLookup` is the shared ID-to-position
authority for later commands.

## Locked rules

- Stored `SmartPos` remains intentionally undiscriminated. The shared resolver
  boundary derives `ResolvedPos.kind`; individual resolvers do not inspect raw
  selection position fields.
- Direction is normalized before resolution. Results are byte-identical for a
  selection and its reverse.
- Because reverse symmetry and original-head clamping cannot both be true,
  isolation clamps toward the normalized document-order end. The choice is
  deterministic and is surfaced as a Phase 2 deviation.
- A block endpoint at offset zero is excluded; an endpoint at that block's end
  is included. Collapsed selections resolve against their containing unit.
- Inline ranges remain partial. Block, container, and list queries promote
  touched inline content to complete structural units.
- A list request over plain blocks returns block structure; list plus plain
  blocks returns `mixed`, so Phase 3 commands see every touched unit once.
- Inline atoms occupy one indivisible offset unit. Positions use the owning
  inline container and can exist only before or after the atom.
- Block atoms are complete blocks. An exact atom selection resolves as an
  atomic-node request, while an inline-range reports `containsAtoms: true`.
- Scope references use stable node IDs. `commonParentId` is non-null only when
  every selected block has the same direct parent.
- A block/list/container scope never crosses an isolating boundary. Sibling
  cells in the same table are the deliberate table-grid exception; the table
  is the containing isolation scope.
- Table grids use logical coordinates. Row/column spans are not expanded or
  repaired: external span anchors are reported through `coveredCellIds`, and
  incomplete logical coverage yields `rectangular: false`.
- `describe` observes the original, unclamped selection so toolbar consumers
  can see `spansIsolatingBoundary`; actionable scopes use the shared clamp.
- List/table recognition reads `NodeSpec.semanticRole` first and falls back to
  conventional built-in names in the single shared `roleOf` helper.
- `SelectionDescription` contains document-derived facts only. Stored marks are
  editor state and are composed by callers rather than returned by resolution.

## Container stop predicates

For a single selected block, `stopAt` promotes the tree root to the nearest
matching ancestor. For multiple blocks, that promotion happens only when the
same matching ancestor contains every selected block. Otherwise the resolver
uses their lowest common ancestor. The predicate reports structure only and
does not receive command identity.

## Complexity

The stateless compatibility call builds a read-only index. Editor instances own
an incremental index and reuse entries while node references are unchanged.
Warm local queries are near-flat and never clone or mutate the document.
Topology-preserving edits currently reflow document ranks, so the first query
after an edit remains cheaply linear in live-node count; this is an explicit
implementation limitation, not a semantic difference.
