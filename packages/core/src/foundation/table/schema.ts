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
      background: optionalString,
      // `borders`: legacy uniform (all 4 sides) CSS border shorthand -
      // still the only shape HTML paste-import ever produces. `borderTop`/
      // `borderRight`/`borderBottom`/`borderLeft`: per-side overrides (the
      // "which sides" control the border-options UI added) - each, when
      // set, wins over `borders` for that one side only; see
      // surface/renderer.ts's per-side application order. Independent
      // optional strings rather than one structured attr so an unset side
      // round-trips as simply absent, matching every other optional cell
      // style attr in this schema.
      borders: optionalString, borderTop: optionalString, borderRight: optionalString, borderBottom: optionalString, borderLeft: optionalString,
      verticalAlign: { validate: (value) => value === "top" || value === "middle" || value === "bottom" },
    },
  },
];
