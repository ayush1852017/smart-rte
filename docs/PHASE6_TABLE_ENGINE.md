# Phase 6 table engine contract

The table write side uses the same cached `occupancyGridFor(table)` materialization as Phase 2 scope resolution. Coordinates are logical and rectangles use exclusive `bottom`/`right` bounds internally. A spanning cell has one anchor node; every other occupied coordinate reports the same `cellId` with `isAnchor: false`. The cache is editor-local through the owning model reference and is valid only while the table node reference is unchanged.

Locked behavior:

- Cells contain `block+`, cells are isolating, and tables are not isolating.
- `columnWidths` belongs to the table. Merged-cell rendered width is the sum of its logical columns.
- Removing the final row or final column removes the table.
- Merge accepts a complete rectangular grid selection only, uses the top-left anchor, rejects a mixed header/body region, and appends all cell blocks in row-major reading order.
- Split creates cells for the occupied coordinates and keeps all content in the anchor. Split is deliberately **not** the inverse of merge; transaction undo is the exact inverse and restores spans, content, dimensions, IDs, and selection.
- Inserting/removing a row or column grows, moves, or shrinks span anchors according to whether the axis crosses, owns, or merely covers the anchor.
- Cell selections expand until every touched span is fully contained. The model stores directional anchor/head positions; the DOM overlay is marked `data-smart-ui="table-cell-selection"` and is never serialized into the model.
- Table navigation owns Tab before list indentation and code-block indentation. Tab/Shift+Tab traverse cells in logical reading order; Tab in the final cell appends a row.
- Header cells are an attribute, and a valid header region is the union of contiguous leading rows and leading columns.

The Markdown exporter is explicitly lossy: anchor content is emitted, covered grid positions are empty, and all text survives. DOCX output exposes `gridSpan`, `vMerge`, header state, and table-owned grid widths. PDF output is visual and page overflow remains renderer-owned.

## Migration boundary

ClassicEditor now calls the foundation table commands through one parse → command → render adapter. That adapter is transitional scaffolding and is scheduled for removal when canonical state becomes authoritative at Phase 8. The retained legacy engine exists only under `packages/react/src/test-harness` and was committed before product migration.
