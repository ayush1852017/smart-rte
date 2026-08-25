import type { NodeSpec } from "../types.js";

const positiveInt = { default: 1, validate: (value: unknown) => Number.isInteger(value) && Number(value) >= 1 };
const optionalString = { validate: (value: unknown) => typeof value === "string" };

export const tableNodeSpecs: readonly NodeSpec[] = [
  {
    type: "table", group: "block", semanticRole: "table", content: "table_row+", isolating: false,
    attributes: {
      columnWidths: { validate: (value) => Array.isArray(value) && value.every((width) => Number.isFinite(width) && Number(width) > 0) },
      caption: optionalString,
      layout: { validate: (value) => value === "auto" || value === "fixed" },
    },
  },
  // "table_cell*", not "+": a row every one of whose columns is covered by
  // an earlier row's rowspan legitimately has zero own cells (e.g. after
  // merging a selection that spans that row's full width). Row count still
  // has to match grid.rows for rowspan bookkeeping, so the row node itself
  // must exist even when empty - it cannot simply be deleted. See
  // docs/bugs/table-row-empty-rowspan-coverage-rejected.md.
  { type: "table_row", group: "block", semanticRole: "table-row", content: "table_cell*", attributes: { height: { validate: (value) => Number.isFinite(value) && Number(value) > 0 } } },
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
