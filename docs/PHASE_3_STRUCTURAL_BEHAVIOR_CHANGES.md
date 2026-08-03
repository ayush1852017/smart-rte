# Phase 3 Structural List Behavior-Change Catalogue

## Evidence boundary

The Phase 3 dual-engine shadow corpus compared list creation, unwrap, indent,
outdent, and style. It did **not** compare Enter, Backspace, or Delete against
the former ClassicEditor DOM path. Those legacy structural edits were deleted
before the comparator ran.

The former code did not implement deterministic list-specific Enter,
Backspace, or Delete semantics. Except for adjacent inline atoms, it allowed the
browser's native `contentEditable` mutation and normalized the resulting HTML
on `input`. Consequently, the precise legacy result could differ between
Chromium, Firefox, and WebKit. The catalogue below records the now-explicit
canonical behavior and identifies every intentional or potentially observable
change. It is evidence of the behavior change, not a retroactive shadow result.

## Catalogue

| Intent | Former ClassicEditor behavior | Canonical behavior | Classification |
|---|---|---|---|
| Enter in item text | Browser-native list split; no cross-browser structural contract. | Splits the item at the logical model position into two same-depth items. | Determinism change; potentially observable. |
| Enter at item start | Browser-native. | Inserts an empty item before; content and caret remain with the original item. | Explicit canonical policy. |
| Enter at item end | Browser-native. | Inserts an empty item after and places the caret there. | Explicit canonical policy. |
| Enter in empty nested item | Browser-native outdent/exit behavior varied by engine and DOM shape. | Outdents one level and records one structural history step. | Intentional normalization. |
| Enter in empty depth-0 item | Browser-native list exit. | Unwraps to a paragraph and exits the list. | Intended parity, now deterministic. |
| Split item with nested descendants | Browser decided where the nested DOM remained. | Descendants stay with the second half. | Intentional policy; user-visible on complex items. |
| Backspace at nested item start | Browser-native merge/outdent behavior. | Outdents; it never merges at depth greater than zero. | Intentional policy. |
| Backspace at first depth-0 item | Browser-native. | Unwraps the item to a paragraph. | Intended parity, now deterministic. |
| Backspace after a flat preceding item | Browser-native DOM merge. | Merges into the preceding item's last content owner. | Intended semantic parity. |
| Backspace after a preceding subtree | Browser-native result depended on DOM/caret behavior. | Merges into the deepest final visible descendant (`resolvePrecedingContentTarget`). | High-risk intentional policy; no legacy shadow evidence. |
| Delete at item end | Browser-native DOM merge. | Mirrors Backspace using the first next visible content target, including nested descendants. | High-risk intentional policy; no legacy shadow evidence. |
| Backspace/Delete adjacent to an atom | Explicit legacy atom deletion existed. | Atom remains one indivisible model unit and is deleted as a node. | Intended parity, covered by canonical browser tests. |
| Tab in an ordinary list | Explicit legacy DOM indent/outdent. | Canonical `list.indent`/`list.outdent`. | Intended parity with stricter legality. |
| Tab in a list inside a table cell | Legacy list indentation won before table navigation. | Table navigation wins; list depth is unchanged. | Approved intentional divergence. |
| Move item up/down | Direct legacy `li` sibling reordering. | Pure `list.move` moves one contiguous selected run by one sibling, preserving IDs and complete nested subtrees. | Restored intended parity; tested in all three browsers. |
| Structural undo grouping | Native DOM mutation was captured through HTML history snapshots. | Every structural intent and its repairs is exactly one non-coalescing history step. | Intentional history change. |
| Selection after a structural edit | Depended on browser DOM mutation and fallback focus code. | Selection is mapped/restored semantically, including direction where available. | Intentional consistency improvement. |

## Process rule for Phase 4 onward

For each migrated feature, retain the legacy execution path in a **test-only
harness before production deletion**. Run and review the dual-engine corpus,
then flip the product route, observe it, and only then delete production legacy
mutation code. If a legacy behavior cannot be retained, the exit gate must say
"behavior catalogue" rather than "shadow-equivalent" for that behavior.
