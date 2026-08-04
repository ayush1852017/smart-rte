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
