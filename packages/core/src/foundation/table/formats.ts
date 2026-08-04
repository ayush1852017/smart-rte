import { isTextNode } from "../identity.js";
import { parseCanonicalListHtml, serializeCanonicalListHtml, serializeCanonicalListMarkdown } from "../list/formats.js";
import type { SmartDocument, SmartElementNode } from "../types.js";
import { occupancyGridFor } from "./grid.js";

export const parseCanonicalTableHtml = parseCanonicalListHtml;
export const serializeCanonicalTableHtml = serializeCanonicalListHtml;

/** GFM is intentionally lossy: anchor content survives and covered coordinates are emitted empty. */
export const serializeCanonicalTableMarkdown = serializeCanonicalListMarkdown;

export interface CanonicalDocxTableCell {
  readonly cellId: string;
  readonly row: number;
  readonly column: number;
  readonly gridSpan: number;
  readonly verticalMerge: "restart" | "continue" | null;
  readonly header: boolean;
  readonly text: string;
}

export interface CanonicalDocxTable {
  readonly tableId: string;
  readonly columnWidths: readonly number[];
  readonly cells: readonly CanonicalDocxTableCell[];
}

const textOf = (node: SmartElementNode): string => (node.children || []).map((child) =>
  isTextNode(child) ? child.text : textOf(child)).join("\n");

/** Semantic DOCX table data maps to gridCol/gridSpan/vMerge/tcPr in the exporter. */
export const canonicalTablesToDocx = (document: SmartDocument): CanonicalDocxTable[] => {
  const tables: CanonicalDocxTable[] = [];
  const visit = (node: SmartElementNode) => {
    if (node.type === "table") {
      const grid = occupancyGridFor(node);
      const cells: CanonicalDocxTableCell[] = [];
      grid.anchors.forEach((anchor) => {
        cells.push({ cellId: anchor.cellId, row: anchor.top, column: anchor.left,
          gridSpan: anchor.right - anchor.left, verticalMerge: anchor.bottom - anchor.top > 1 ? "restart" : null,
          header: anchor.node.attrs?.header === true, text: textOf(anchor.node) });
        for (let row = anchor.top + 1; row < anchor.bottom; row += 1) cells.push({
          cellId: anchor.cellId, row, column: anchor.left, gridSpan: anchor.right - anchor.left,
          verticalMerge: "continue", header: anchor.node.attrs?.header === true, text: "",
        });
      });
      tables.push({ tableId: node.id,
        columnWidths: Array.isArray(node.attrs?.columnWidths) ? node.attrs.columnWidths as number[] : Array(grid.columns).fill(120), cells });
    }
    (node.children || []).forEach((child) => { if (!isTextNode(child)) visit(child); });
  };
  visit(document);
  return tables;
};

/** PDF fidelity is visual; page overflow and splitting are renderer-owned. */
export const canonicalTablePdfText = (document: SmartDocument): string => canonicalTablesToDocx(document)
  .map((table) => table.cells.filter((cell) => cell.verticalMerge !== "continue")
    .map((cell) => `[${cell.row},${cell.column}] ${cell.text}`).join("\n"))
  .join("\n\n");
