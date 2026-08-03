# Canonical Inline Formatting Contract

All inline tools are declarations over one mark engine. Commands are pure
functions of `(document, scope, params, ctx)` and return operations; callers own
transactions and selection mapping.

Marks are sorted by type and then stable serialized attributes. Adjacent equal
runs merge and zero-length runs disappear. Attributed values are canonicalized
at parse/command boundaries, never silently inside the model.

`hard_break` is an atomic inline node of width one and carries no marks. Mark
application skips atomic nodes and applies to eligible neighboring text.

Stored marks live in editor state. A collapsed apply/toggle changes stored
marks; the next text insertion or composition consumes them. Selection changes
and non-consuming transactions clear them, and undo/redo restore them exactly.

Composition compares marked text tokens. During active composition the DOM is
authoritative for the composing owner and the renderer performs zero writes to
it. Atom tokenization is explicitly deferred to Phase 7.
