# Remaining Legacy List-Touching Inventory

This inventory is enforced by `scripts/check-phase3-contract.mjs`. Each entry
has a matching `LEGACY_LIST_TOUCHPOINT` marker in ClassicEditor. Removing or
adding a marker without updating this inventory fails the Phase 3 contract
gate.

| Marker | Current behavior | Owning phase | Removal condition |
|---|---|---|---|
| `imported-list-normalization` | Repairs sibling nested lists and item-level marker styles in imported HTML. | Phase 8 | Clipboard/import parsing produces canonical fragments before insertion. |

Phase 5 removed the blockquote/code paths and Phase 6 removed table extraction;
the remaining import path belongs to Phase 8. Gate 4 therefore remains qualified until the inventory reaches zero. No entry
may be removed from this file merely to satisfy grep; its owning phase must
replace the behavior and its tests.
