# Phase 7 atomic content contract

This document records the decisions frozen by Phase 7. Atomic content reuses the
Phase 1 position rule: an inline atom occupies one indivisible offset unit, and no
position or grapheme boundary exists inside it.

## Model and declarations

- Inline and block atoms use distinct node types (`image` / `block_image` and
  `formula` / `block_formula`). Content-expression membership therefore remains
  static and schema-checkable.
- `video` and `audio` are block atoms.
- Atoms are selectable, read-only model leaves and carry no marks.
- Upload state is an attribute (`pending`, `ready`, or `error`) on the original
  atom. Completion never replaces the node, so its ID survives.
- Special characters are Unicode text, not atoms.
- Atom commands are declaration-driven. Adding a schema declaration does not add
  command logic.

## Async and persistence

Insertion and upload completion are separate transactions. Upload work never
runs inside a transaction. Completion uses `setNodeAttributes`, is excluded from
history, and is applied only if the stable node ID still exists. A late result for
a removed node is discarded.

Saving while any atom is pending is rejected. Blob URLs are also rejected from
the persisted envelope, regardless of status. A failed upload remains as an error
atom so the user can retry or remove it; errors are not silently dropped.

## Selection, deletion, and resize

- Clicking an atom creates a node selection.
- Inline atoms delete directly when Backspace reaches them.
- Block atoms require a first Backspace to select and a second to delete.
- Typing over a selected atom replaces it with text; Shift+Arrow treats it as one
  unit; deleting the sole atom in a block leaves a valid empty block.
- Resize is gesture-coalesced: intermediate `setNodeAttributes` transactions
  share one `historyGroup`, producing one undo step. Resize handles are
  `data-smart-ui` nodes and are never serialized.

## Composition

Composition reconciliation tokenizes model text and atoms separately. Atoms are
opaque one-unit tokens, and a composition terminates and reconciles at an atom
boundary rather than spanning it. The renderer performs zero writes to the
composing owner while composition is active.

## Security boundary

- Resource URLs pass through the shared Phase 4 URL policy. `javascript:`,
  `vbscript:`, `file:`, malformed URLs, and unapproved data MIME types are
  rejected. Only explicit raster-image data MIME types are accepted.
- SVG user content is never inserted as inline SVG. An SVG accepted by an upload
  service must be displayed through an `<img src>` resource boundary.
- Formula source reaches the DOM only through text nodes or an accessible label.
  KaTeX is configured with `trust: false` and `strict: "error"`; no evaluation,
  user `innerHTML`, or unsandboxed frame is allowed.
- Atom DOM roots are `contentEditable=false`.
- Client MIME checks are preflight validation only. The injected upload backend
  remains responsible for server-side MIME/content verification.
- The implementation requires neither `unsafe-inline` nor `unsafe-eval`.

## Format fidelity

HTML preserves atom semantics. Markdown preserves images and formula source,
while media uses a non-destructive unsupported fallback. DOCX treats formulas as
lossy rendered-image fallbacks rather than claiming partial OMML support. PDF is
visual/lossy for all atom types.

