# Remaining Legacy List-Touching Inventory

This inventory is enforced by `scripts/check-phase3-contract.mjs`. Each entry
has a matching `LEGACY_LIST_TOUCHPOINT` marker in ClassicEditor. Removing or
adding a marker without updating this inventory fails the Phase 3 contract
gate.

| Marker | Current behavior | Owning phase | Removal condition |
|---|---|---|---|
| `blockquote-list-shell-split` | Splits or moves list shells when only some items are quoted. | Phase 5 | Block/blockquote commands operate on canonical list-aware scopes. |
| `code-block-list-item-restructure` | Moves list-item children into/out of a legacy code block. | Phase 5 | Block commands own canonical code-block content. |
| `table-extraction-from-list` | Moves a table out of a list item during compatibility normalization. | Phase 6 | Canonical table insertion and normalization own the invariant. |
| `imported-list-normalization` | Repairs sibling nested lists and item-level marker styles in imported HTML. | Phase 8 | Clipboard/import parsing produces canonical fragments before insertion. |

Gate 4 therefore remains qualified until the inventory reaches zero. No entry
may be removed from this file merely to satisfy grep; its owning phase must
replace the behavior and its tests.
