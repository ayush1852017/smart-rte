# Temporary Migration Adapter Inventory

The parse → command → render adapters are migration scaffolding, not reusable
editor architecture. ClassicEditor remains DOM-authoritative between commands
until the end of Phase 8.

**Active adapter count: 4** (three feature bridges plus the Phase 8a product insertion bridge)

| Marker | Introduced | Deletion owner | Purpose |
|---|---|---|---|
| `canonical-list-dom-roundtrip` | Phase 3 | Phase 8 | Parses a bounded list DOM fragment, executes pure canonical commands, renders it back, and restores selection. |
| `canonical-inline-dom-roundtrip` | Phase 4 | Phase 8 | Parses selected inline owners, executes the one pure mark engine, renders owner interiors, and restores direction. |
| `canonical-block-dom-roundtrip` | Phase 5 | Phase 8 | Parses the bounded block parent, executes pure canonical block commands, renders it back, and restores selection direction. |
| `canonical-clipboard-dom-insert` | Phase 8a | Phase 8b | Parses through the canonical clipboard pipeline, serializes clean HTML, then delegates final insertion to `execCommand("insertHTML")`. |

The feature-adapter count reached its declared peak of three in Phase 5 and did
not grow in Phases 6–7. Phase 8a introduced the separately disclosed product
clipboard insertion bridge, making the honest authority-boundary count four.
Phase 8b must retire all four and end at zero when the product editor becomes
canonical-authoritative. Every active adapter requires a `MIGRATION_ADAPTER`
source marker and a named deletion owner.
