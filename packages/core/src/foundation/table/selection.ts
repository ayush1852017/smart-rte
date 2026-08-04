import type { PositionLookup } from "../scope/types.js";
import type { SmartElementNode, SmartSelection } from "../types.js";
import { occupancyGridFor } from "./grid.js";
import type { CellSelectionRect, Rect } from "./types.js";

/** Expands a logical rectangle until every intersected merged cell is fully contained. */
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

/** Model cell selections store direction as anchor/head positions while the overlay consumes the snapped rectangle. */
export const cellSelectionFromIds = (anchorCellId: string, headCellId: string, positions: PositionLookup): SmartSelection | null => {
  const anchor = positions.contentRangeOf(anchorCellId)?.from;
  const head = positions.contentRangeOf(headCellId)?.to;
  return anchor && head ? { type: "cell", anchor, head } : null;
};
