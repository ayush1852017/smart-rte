# Smart RTE Architecture

## Direction

Smart RTE is moving from React-owned `contentEditable` behavior to a
framework-agnostic TypeScript editing core. The existing React API remains
stable during the migration:

```tsx
<ClassicEditor value={html} onChange={setHtml} />
```

The compatibility contract is HTML in and HTML out. Existing toolbar styling,
theme tokens, import/export formats, media adapters, and feature flags remain
part of the React package contract.

Markdown and HTML use separate import paths:

```text
Markdown -> CommonMark/GFM parser -> canonical HTML -> Smart RTE model
HTML     -> HTML sanitizer/parser -> canonical HTML -> Smart RTE model
```

Markdown indentation is semantic input and must be preserved. Flat HTML stays
flat by default: Smart RTE does not infer nested lists that are absent from the
source HTML. Any future repair heuristic must be explicit and opt-in.

## Editing pipeline

```text
HTML / paste / user action
  -> parser and normalizers
  -> SmartDocument + SmartSelection
  -> command
  -> SmartTransaction
  -> history
  -> editing renderer
  -> HTML serializer
```

Browser DOM selection is an input to the selection bridge. It is not the
editor's source of truth. Editor-only UI, including table wrappers, resize
handles, overlays, menus, and placeholder nodes, must never be serialized.

## Package boundaries

```text
packages/core   framework-independent model, selection, commands, history,
                normalization, parsing, and serialization contracts
packages/react  ClassicEditor UI, DOM bridge, toolbar, dialogs, and renderer
plugins/*       table, media, formula, special characters, import/export
```

`packages/react` must not expose a new public API solely because core is
introduced. Core adoption is incremental and feature-flagged until parity is
proven.

## Document invariants

- A document contains block nodes.
- A table cell contains block nodes, never raw text or editor wrappers.
- Structural wrappers are renderer-only.
- Commands affect only the resolved selection.
- A transaction is the only way to mutate editor state.
- Every user-visible mutation has an inverse history operation.

## Selection and commands

Core supports text, node, cell, and all-document selections. A command checks
schema and selection, creates a transaction, runs normalizers, updates history,
and returns the next selection. Commands do not access React state or mutate
DOM directly.

## Compatibility and rollout

1. Preserve existing HTML parser/serializer behavior with fixture tests.
2. Run the core behind an internal feature flag.
3. Migrate selection-sensitive commands first: list, quote, code, links,
   colors, superscript, and subscript.
4. Rebuild tables as a core plugin after parser/serializer parity exists.
5. Release the core as opt-in before making it the default.

Invalid legacy HTML may be normalized on load, for example a table nested in a
code block. Such normalization must be documented and covered by fixtures.

Before migrating more commands, compatibility fixtures define the parser and
serializer gate. Comparisons are semantic rather than byte-perfect: a table
cell containing `one<br>two` may canonicalize to two paragraphs, but editor
wrappers must not leak and valid semantic blocks must not become invalid nested
content.

## Shadow mode

Core commands remain opt-in until the DOM bridge and serializer reach feature
parity. In development, the migration adapter must support shadow mode:

```text
legacy input HTML -> legacy output
same input HTML   -> core parser/serializer output
                    -> semantic comparison and diagnostic log
```

Shadow mode never changes the persisted value. A mismatch is a fixture or
normalizer task, not a reason to silently change existing customer content.

## React adapter boundary

The React adapter is responsible only for mapping DOM input into core data:

```text
DOM Range -> SmartSelection -> core command -> SmartTransaction
SmartDocument -> editing DOM -> existing onChange HTML
```

The adapter may render wrappers and handles, but those nodes never become core
model nodes or exported HTML. The first core commands are table-cell scoped
list conversion and selected-block code toggling; both are covered in core
tests before any `ClassicEditor` wiring.

## DOM Selection Bridge

`packages/react/src/adapters/domSelectionBridge.ts` converts a browser
`Selection` into `SmartSelection` paths. It treats table wrappers, resize
handles, overlays, and other `data-srte-*` elements as UI-only. In particular,
a selection in a table cell resolves to the cell paragraph, never to its table
wrapper. The bridge is adapter infrastructure only; toolbar commands continue
to use the legacy runtime until command migration begins.

Milestone 1 starts with inline marks before block or table commands: bold,
italic, underline, superscript, and subscript. Each command accepts a
`SmartSelection`, emits one `SmartTransaction`, and is exercised only in core
tests until the DOM selection bridge is ready.

## Testing rules

- Each regression starts with a failing test.
- Commands, normalizers, history, and serializers have unit tests.
- React behavior has Playwright coverage for paste, selection, table, and undo.
- Test commands may not suppress failures with `|| true`.
- Exported HTML must not contain editor-only attributes or wrappers.
