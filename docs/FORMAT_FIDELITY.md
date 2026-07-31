# Built-in format fidelity

Smart RTE treats HTML as its canonical interchange format. Markdown and DOCX
preserve portable semantics where their standards permit it. PDF is a
layout-oriented print/import boundary and is not presented as a semantic
round-trip format.

The executable contract lives in
`packages/react/src/formatFidelity.ts`. Each feature/format pair is classified:

- `full`: canonical structure and supported attributes round-trip.
- `semantic`: meaning round-trips, but representation or host metadata changes.
- `lossy`: useful import/export exists with documented information loss.
- `unsupported`: the adapter intentionally has no representation yet.

Changes to an adapter must update the executable matrix and its round-trip
fixtures together. A feature must not be advertised as `full` without a
canonical model round-trip test.

Current priorities:

1. Keep HTML at full fidelity for every canonical node and mark.
2. Preserve portable Markdown semantics, including GFM tables and task lists.
3. Preserve native DOCX numbering, hyperlinks, embeddable images, and OMML
   formula objects; expand image-source support and improve formula typography
   without sacrificing canonical source round-trips.
4. Keep PDF behavior explicitly heuristic and layout-oriented.
