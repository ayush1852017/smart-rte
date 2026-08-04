# Phase 8 canonical-authority and adapter-removal plan

Phase 8 ends the temporary DOM-authoritative product architecture. The product
editor will own one persistent `FoundationEditor` instance whose document,
selection, stored marks, history, and revision are the only mutable editing
state. ClassicEditor's DOM becomes a projection through
`FoundationSubtreeRenderer`; DOM parsing remains only at explicit import and
clipboard boundaries.

## Product-state transition

1. Construct canonical state once from the initial product value, repair and
   validate it, then retain the editor and scope index for the component's
   lifetime.
2. Route input, selection, toolbar, keyboard, and API intents to pure foundation
   commands. The caller owns transactions and renderer updates.
3. Serialize product callbacks from canonical state. Never parse the live editor
   DOM to discover current state.
4. Reconcile externally replaced values as explicit state replacement, with a
   revision boundary and selection mapping policy.

## Renderer takeover

Mount `FoundationSubtreeRenderer` on the production editable root. Preserve DOM
selection after every committed transaction, keep editor UI under
`data-smart-ui`, and keep composition ownership in the native composing subtree
until `compositionend`. Product decorations and overlays are projected nodes,
not model children.

## Adapter retirement order

1. Retire `canonical-inline-dom-roundtrip` after product input, stored marks,
   links, and atom composition use persistent canonical state.
2. Retire `canonical-block-dom-roundtrip` after block/list/table toolbar and
   keyboard commands resolve scopes from the retained editor.
3. Retire `canonical-list-dom-roundtrip` after fragment insertion and clipboard
   normalization no longer parse the live list DOM.

The inventory must move `3 -> 2 -> 1 -> 0` in reviewed commits. No replacement
parse-command-render adapter is permitted.

## Shadow gate without a feature boundary

Replay complete editor sessions from the same initial persisted envelope into
the retained pre-takeover product harness and the canonical-authoritative
surface. Compare normalized, ID-stripped structure plus semantic selection after
every intent. Include typing, composition, every migrated command, history,
external value replacement, and clipboard fragments across Chromium, Firefox,
and WebKit. Hash-only logs remain mandatory. Deletion happens only after no
unexplained semantic or data-loss divergence remains.

