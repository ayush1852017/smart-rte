# Temporary Migration Adapter Inventory

**Active canonical-product adapter count: 0.**

The rollback implementation deliberately retains four DOM-authoritative bridges.
They are unreachable when canonical authority is enabled, but remain a real
exception to repository-wide single authority and are counted below.

| Marker | Introduced | Deletion owner | Purpose |
|---|---|---|---|
| `canonical-list-dom-roundtrip` | Phase 3 | rollback removal after flag promotion | Legacy rollback only. Parses a bounded list DOM fragment, executes pure canonical commands, and renders it back. |
| `canonical-inline-dom-roundtrip` | Phase 4 | rollback removal after flag promotion | Legacy rollback only. Parses selected inline owners and renders mark changes back. |
| `canonical-block-dom-roundtrip` | Phase 5 | rollback removal after flag promotion | Legacy rollback only. Parses a bounded block parent and renders structural changes back. |
| `canonical-clipboard-dom-insert` | Phase 8a | rollback removal after flag promotion | Legacy rollback only. Uses sanitized canonical HTML and Range insertion; the canonical product pipeline inserts fragments as operations. |

Phase 8b retires the adapters from the canonical product graph rather than
deleting the only runtime rollback implementation before promotion. The dormant
count is therefore four and the active-product count is zero. Every bridge that
becomes reachable from canonical authority must carry a `MIGRATION_ADAPTER`
marker and fail the Phase 8b contract gate.

**Phase 8b Gate 12 tracker wording:** the four adapters are unreachable from the
canonical path; deletion is triggered after flag promotion. Their retained
existence is the rollback mechanism required by Gate 1, not a pre-promotion
failure. Post-promotion deletion remains mandatory and is the event that closes
the repository-wide exception.
