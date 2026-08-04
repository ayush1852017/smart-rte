# Phase 6 Table Grid Engine completion report

**Overall status: HOLD on exit gate 13 only.** All four stop conditions (gates 2, 3, 5, and 18) pass. Automated table accessibility and three-browser behavior pass, but NVDA + Chrome table-mode was not manually validated in this environment, so the specification does not permit claiming full Phase 6 completion.

## A. Implemented interfaces (verbatim)

Table node specs:

```ts
export const tableNodeSpecs: readonly NodeSpec[] = [
  {
    type: "table", group: "block", semanticRole: "table", content: "table_row+", isolating: false,
    attributes: {
      columnWidths: { validate: (value) => Array.isArray(value) && value.every((width) => Number.isFinite(width) && Number(width) > 0) },
      caption: optionalString,
      layout: { validate: (value) => value === "auto" || value === "fixed" },
    },
  },
  { type: "table_row", group: "block", semanticRole: "table-row", content: "table_cell+", attributes: { height: { validate: (value) => Number.isFinite(value) && Number(value) > 0 } } },
  {
    type: "table_cell", group: "block", semanticRole: "table-cell", content: "block+", isolating: true,
    attributes: {
      colspan: positiveInt, rowspan: positiveInt,
      header: { default: false, validate: (value) => typeof value === "boolean" },
      background: optionalString, borders: optionalString,
      verticalAlign: { validate: (value) => value === "top" || value === "middle" || value === "bottom" },
    },
  },
];
```

Occupancy grid and command contract:

```ts
export interface Rect {
  readonly top: number;
  readonly left: number;
  /** Exclusive. */
  readonly bottom: number;
  /** Exclusive. */
  readonly right: number;
}

export interface GridCell {
  readonly cellId: string;
  readonly top: number;
  readonly left: number;
  /** Exclusive. */
  readonly bottom: number;
  /** Exclusive. */
  readonly right: number;
  readonly isAnchor: boolean;
  readonly rowIndex: number;
  readonly childIndex: number;
  readonly node: SmartElementNode;
}

export interface OccupancyGrid {
  readonly tableId: string;
  readonly rows: number;
  readonly columns: number;
  readonly anchors: readonly GridCell[];
  at(row: number, col: number): GridCell | null;
  anchorsIn(rect: Rect): GridCell[];
  coveredIn(rect: Rect): GridCell[];
  isRectangular(rect: Rect): boolean;
}

export interface TableCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type TableCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: TableCommandContext,
) => SmartOperation[];
```

Command set:

```ts
export const tableCommands = {
  "table.insert": insertTableCommand,
  "table.remove": removeTableCommand,
  "table.insertRow": insertTableRowCommand,
  "table.removeRow": removeTableRowCommand,
  "table.insertColumn": insertTableColumnCommand,
  "table.removeColumn": removeTableColumnCommand,
  "table.mergeCells": mergeTableCellsCommand,
  "table.splitCell": splitTableCellCommand,
  "table.setHeader": setTableHeaderCommand,
  "table.setCellAttributes": setTableCellAttributesCommand,
  "table.setColumnWidth": setTableColumnWidthCommand,
  "table.setRowHeight": setTableRowHeightCommand,
  "table.moveRow": moveTableRowCommand,
  "table.moveColumn": moveTableColumnCommand,
} as const;
```

Cell-selection types and entry points:

```ts
export interface CellSelectionRect {
  readonly tableId: string;
  readonly anchorCellId: string;
  readonly headCellId: string;
  readonly rect: Rect;
  readonly cellIds: readonly string[];
}

export const snapTableCellRect = (table: SmartElementNode, input: Rect): CellSelectionRect => {
  const grid = occupancyGridFor(table);
  const rect = {
    top: Math.max(0, Math.min(input.top, grid.rows - 1)),
    left: Math.max(0, Math.min(input.left, grid.columns - 1)),
    bottom: Math.max(1, Math.min(input.bottom, grid.rows)),
    right: Math.max(1, Math.min(input.right, grid.columns)),
  };
  let changed = true;
  while (changed) {
    changed = false;
    grid.anchors.forEach((cell) => {
      if (cell.top < rect.bottom && cell.bottom > rect.top && cell.left < rect.right && cell.right > rect.left) {
        const next = { top: Math.min(rect.top, cell.top), left: Math.min(rect.left, cell.left), bottom: Math.max(rect.bottom, cell.bottom), right: Math.max(rect.right, cell.right) };
        if (next.top !== rect.top || next.left !== rect.left || next.bottom !== rect.bottom || next.right !== rect.right) {
          Object.assign(rect, next); changed = true;
        }
      }
    });
  }
  const anchor = grid.at(rect.top, rect.left);
  const head = grid.at(rect.bottom - 1, rect.right - 1);
  if (!anchor || !head) throw new Error("Cell selection rectangle does not resolve to a complete table grid.");
  return { tableId: table.id, anchorCellId: anchor.cellId, headCellId: head.cellId, rect, cellIds: grid.anchorsIn(rect).map((cell) => cell.cellId) };
};

export const cellSelectionFromIds = (
  anchorCellId: string,
  headCellId: string,
  positions: PositionLookup,
): SmartSelection | null => {
  const anchor = positions.contentRangeOf(anchorCellId)?.from;
  const head = positions.contentRangeOf(headCellId)?.to;
  return anchor && head ? { type: "cell", anchor, head } : null;
};
```

## B. Deviations from spec

1. **Structural table commands emit a self-inverting `replaceNode` for the table rather than a long sequence of fine-grained cell operations.** The table ID and every surviving row/cell/block ID are retained, and inversion is exact. This reduced the number of partially valid intermediate grids. Reversal blast radius: medium; command consumers only see `SmartOperation[]`, but collaboration/rebase may eventually prefer smaller operations.
2. **`table.insert` gained additive `placement: "before" | "after"`.** The product toolbar inserts after the active block without constructing operations itself. Reversal blast radius: low; optional parameter with no existing caller break.
3. **Moving a logical row or column across a rowspan/colspan is a no-op.** The spec did not lock this case. Reordering only part of a spanning cell is ambiguous; refusing preserves geometry and content. Reversal blast radius: low at the API, medium in behavior if a later product policy chooses span-aware reflow.
4. **An isolated non-leading body-cell “make header” request is refused.** It conflicts with the new geometry invariant that headers are contiguous leading rows/columns. Existing leading row/column operations are supported. Reversal blast radius: high if arbitrary headers are later allowed because schema validation, repair, HTML association, and commands all encode the leading-region rule.
5. **ClassicEditor still uses a parse → pure command → render adapter because it is not canonical-state authoritative until Phase 8.** No legacy core table command is invoked in production, but the adapter remains transitional scaffolding. Reversal blast radius: intentionally low; the pure table commands and foundation model are behind it.
6. **The retained dual-engine corpus is a unit/jsdom corpus, while the structural product matrix is the three-browser corpus.** The retained legacy engine depends on legacy model serialization, not browser-native table mutation. Reversal blast radius: none to contracts; evidence strength is lower than a dual-engine browser run.
7. **NVDA manual validation is incomplete.** This is a gate failure, not an accepted implementation deviation.

## C. Locked decisions

- **Anchor/covered:** one cell node and one anchor coordinate; all span-covered coordinates return the same ID with `isAnchor: false`.
- **Merge content:** top-left anchor; append every selected cell's block children in row-major reading order; never discard content.
- **Header-boundary merge:** reject mixed header/body selections.
- **Split vs undo:** split keeps concatenated content in the anchor and is not merge inversion; transaction undo is exact.
- **Last axis:** removing the final row or final column removes the table.
- **Width ownership:** `columnWidths` belongs only to the table; a merged cell derives width from its logical columns.
- **Tab:** table navigation wins before list and code-block handling; final-cell Tab appends a row.
- **Selection snapping:** repeatedly expand until every intersecting span is fully contained. Model direction remains anchor/head; DOM overlay uses `data-smart-ui="table-cell-selection"`.
- **Headers:** cell boolean attribute; valid region is the union of leading header rows and leading header columns.
- **Geometry repair:** clamp overhangs, move overlapping anchors to the next free position, pad holes, close the header region, never drop content.

## D. Exit gate results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `scope/resolveScope.ts` and all table commands import `occupancyGridFor`; `scripts/check-phase6-contract.mjs` rejects a private resolver grid. |
| 2 | PASS | `foundation/table/table.test.ts`: 1,000 generated sequences × up to 8 operations, seed `0x6A1D2026`; exact geometry validation after every step. |
| 3 | PASS | `foundation/table/table.test.ts`: merge order/content test plus the same generated algebra test; non-rectangular input returns no operations. |
| 4 | PASS | `foundation/table/table.test.ts` and `docs/PHASE6_TABLE_ENGINE.md`. |
| 5 | PASS | Generated property test fully inverts every emitted operation and deep-equals the starting document, including IDs, spans, dimensions, and content. |
| 6 | PASS | `foundation/table/table.test.ts`, `domTableCommandBridge.test.ts`, and `e2e/table-workflows.spec.ts` (24 table workflow cases across three browsers after Phase 6 additions). Browser coverage is product-path; span edge cases are primarily unit fixtures. |
| 7 | PASS | Existing list/block/mark-in-cell tests remain green; the table parser/renderer delegates cell children to the existing block/inline engines. No feature-specific branch was added to those engines. |
| 8 | PASS | `formats.test.ts` proves model snapping; browser drag and Shift+Arrow tests prove overlay behavior and absence inside editor content. |
| 9 | PASS | Three-browser final-cell Tab test plus existing list-in-cell precedence test; keydown ordering gives table precedence before code blocks. |
| 10 | PASS | Geometry fixture and schema repair tests; HTML round-trip preserves malformed-table content after deterministic repair. |
| 11 | PASS | ClassicEditor direct row/column/span mutation fallbacks deleted; automated contract grep passes. Test-only retained legacy engine is excluded. |
| 12 | PASS | `formats.test.ts`: HTML spans/width/header/caption; Markdown lossy text conservation; DOCX `gridSpan`/`vMerge`; PDF behavior documented. |
| 13 | **FAIL (manual portion)** | Automated semantic DOM, `scope`, `headers`, and axe tests pass in Chromium/Firefox/WebKit. NVDA + Chrome table-mode was not manually run. |
| 14 | PASS | Retention commit `7bb137a` precedes routing `88e5282`, catalogue `019394b`, and deletion `a748a3a`. |
| 15 | PASS | 2,100 retained scenarios, seed `0x7AB1E006`: no semantic/data-loss/unknown classifications; catalogue committed before deletion. |
| 16 | PASS | Before → after: core `332→343`, React `218→221`, browser `132→156`. Phase suites: Phase 1 `67→67`, Phase 2 `13→13`, Phase 2.5 `12→12`, Phase 3 core/React `29/38→29/38`, Phase 4 `15→15`, Phase 5 block `14→14`. Removed tests: **none**. Final full suites: core 343/343, React 221/221, browser 156/156. |
| 17 | PASS | `docs/PERFORMANCE_TRENDS.md`; five samples per browser at 2k, 10k, and 50×50 table. |
| 18 | PASS | Three `MIGRATION_ADAPTER:` markers before and after. Contract lint enforces the cap. |

No exit gate was verified only by hand. Gate 13's required manual portion was not performed.

## E. Known gaps and confidence notes

1. **NVDA + Chrome table-mode is unverified.** Automated markup checks cannot establish the quality of row/column announcements or merged-header navigation.
2. **The product adapter still owns DOM round-tripping.** It is scaffolding, not the final authority model, and must be deleted by Phase 8.
3. **Span-aware row/column move refuses ambiguous moves.** Data is safe, but there is no UI explanation yet when a move is unavailable.
4. **Cold Chromium table paint is noisy.** Steady 50×50 samples are near 13 ms, but first samples reached 35 ms in the final run.
5. **10,000-block headless performance remains above the investigation threshold.** The already-triggered headed `content-visibility` trace remains owed.
6. **Physical assistive-technology and mobile table selection are not represented by Playwright synthetic input.**

## F. Shadow results

Retained corpus: 2,100 scenarios, seed `0x7AB1E006`.

| Classification | Count |
|---|---:|
| Equivalent | 1,500 |
| Expected normalization | 300 |
| Visual only | 300 |
| Selection only | 0 |
| Semantic | 0 |
| Data loss | 0 |
| Unknown | 0 |

The retained comparator runs once as a deterministic unit corpus; the product structural matrix ran in Chromium, Firefox, and WebKit with identical pass outcomes. It is not truthful to multiply the retained count by three and call it a browser dual-engine corpus.

Corrections of legacy behavior, individually:

1. Canonical column insertion materializes a table-owned width entry rather than leaving width ownership implicit/duplicated.
2. Malformed imports are deterministically repaired without content deletion instead of relying on browser-specific DOM repair.
3. Mixed header/body merge is refused instead of inheriting ambiguous semantics from the anchor.
4. A non-leading isolated header cell is refused to preserve a valid, navigable leading header region.

Other intentional difference: header toggle gets established visual defaults in the product projection (`visual-only`, 300 cases).

## G. Template assessment

Approximately **45%** of Phase 6 reused the Phase 3–5 template: pure `(document, scope, params, ctx) → SmartOperation[]` commands, caller IDs, caller transactions/history, foundation-position lookup, format declarations, retained-engine comparator policy, hash-only logging, commit ordering, and adapter/deletion sequencing.

Approximately **55%** was table-specific: occupancy geometry, span-aware axis edits, merge/split content conservation, header association, rectangular cell selection, table navigation, and malformed-grid repair.

Reusable for Phase 7 atoms:

- stable node IDs and caller-supplied creation IDs;
- atomic command outputs and exact inversion;
- reference-keyed derived-data caches;
- UI overlay exclusion and generated-DOM projection exclusion;
- pure command/product-adapter boundary;
- content-conservation and privacy-safe comparator patterns.

Table-only machinery:

- two-dimensional occupancy, anchor/covered slots, rectangles, spans, row/column coordination, and header geometry.

Prediction: Phase 7 should reuse the command/adapter/renderer/comparator scaffolding and none of the grid algorithms. Its genuinely new work is atom lifecycle and atom-aware composition tokenization, not structural coordinates.

## H. Scope leakage

- Media/atom migration: **none**.
- Clipboard parsing: **none**.
- Spreadsheet formulas/sorting/fill: **none**.
- Plugin runtime work: **none**.
- Adapter count: **unchanged at 3**.

Nested tables remain schema/legal-format support only; no nested-table UI was added. The standalone 50×50 fixture is a benchmark harness, not a spreadsheet feature.
