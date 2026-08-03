# Phase 2.5 Canonical Editing Surface

The standalone surface is available in the React playground at
`?canonical=1`. Add `&blocks=10000` for the scale fixture, `&atoms=1` for an
inline-atom fixture, or `&isolation=1` for the semantic table/isolation fixture.
It does not integrate with or modify `ClassicEditor`.

## Apply and indexing contracts

- Operations path-copy only edited ancestor chains. Untouched subtrees retain
  reference identity; `same reference => unchanged subtree` is contractual.
- One editor owns one incremental `ScopeIndex`. Cache validity is based on node
  reference identity and retired IDs are removed on refresh.
- `PositionLookup` is the only foundation ID-to-position implementation.

## Renderer contract

- Reference-identical nodes keep their DOM subtrees.
- DOM updates finish before model selection is restored. Restoration is skipped
  if native anchor/focus already match.
- During composition the composing owner is DOM-authoritative and receives no
  renderer writes. Reconciliation occurs once at `compositionend`.
- `data-smart-ui` children are outside the model and diff.
- Content stays mounted; there is no editable-region virtualization.

## Input contract

- Handled `beforeinput` events are cancelled and converted to transactions.
- Composition is the only native-DOM-authoritative edit path. A composing-owner
  `MutationObserver` supports the Android reconciliation fallback.
- A native selection crossing an isolating boundary is promoted to a node
  selection over the isolating ancestor before entering model state.
- Unknown input types, paste, and drop are cancelled and logged.

The browser suite uses synthetic composition events in Chromium, Firefox, and
WebKit. It validates the architecture and grouping but is not a substitute for
physical-device Android or platform-specific Indic/CJK IME testing.
