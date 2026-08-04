# Temporary Migration Adapter Inventory

The parse → command → render adapters are migration scaffolding, not reusable
editor architecture. ClassicEditor remains DOM-authoritative between commands
until the end of Phase 8.

**Active adapter count: 3 (peak reached in Phase 5)**

| Marker | Introduced | Deletion owner | Purpose |
|---|---|---|---|
| `canonical-list-dom-roundtrip` | Phase 3 | Phase 8 | Parses a bounded list DOM fragment, executes pure canonical commands, renders it back, and restores selection. |
| `canonical-inline-dom-roundtrip` | Phase 4 | Phase 8 | Parses selected inline owners, executes the one pure mark engine, renders owner interiors, and restores direction. |
| `canonical-block-dom-roundtrip` | Phase 5 | Phase 8 | Parses the bounded block parent, executes pure canonical block commands, renders it back, and restores selection direction. |

The count reached its declared peak in Phase 5 and must be reported in every
phase completion report. It must not grow in Phase 6, must decline
during Phases 7–8, and equal zero at Phase 8 exit when the product editor becomes
canonical-authoritative. Every active adapter requires a `MIGRATION_ADAPTER`
source marker and a named deletion owner.
