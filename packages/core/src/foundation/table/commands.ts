import { cloneNode, isTextNode } from "../identity.js";
import { moveContiguousSiblings } from "../structural/move.js";
import type { BlockRangeScope, ResolvedScope, TableGridScope } from "../scope/types.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos } from "../types.js";
import { occupancyGridFor } from "./grid.js";
import type {
  CellAttributesParams, ColumnParams, ColumnWidthParams, GridCell, HeaderParams, InsertTableParams,
  MoveTableAxisParams, RowHeightParams, RowParams, SplitCellParams, TableCommand,
  TableCommandContext,
} from "./types.js";

const tableScope = (scope: ResolvedScope): TableGridScope | null => scope.kind === "table-grid" ? scope : null;
const blockScope = (scope: ResolvedScope): BlockRangeScope | null => scope.kind === "block-range" ? scope : null;
const cleanAttrs = (attrs: Attrs): Attrs => Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));
const emptyCell = (cellId: string, paragraphId: string, header = false, styleAttrs: Attrs = {}): SmartElementNode => ({
  type: "table_cell", id: cellId, attrs: { rowspan: 1, colspan: 1, header, ...styleAttrs },
  children: [{ type: "paragraph", id: paragraphId, children: [] }],
});

/**
 * A newly-inserted row/column defaulted to blank cell styling regardless of
 * neighboring cells - not a broken inheritance attempt, there was never one.
 * New cells now default to the immediately adjacent existing row/column's
 * per-cell style so "Add row"/"Add column" continues a styled table's
 * look instead of visibly breaking it. Structural attrs (rowspan/colspan/
 * header) are handled separately and are deliberately excluded here.
 */
const CELL_STYLE_ATTR_KEYS = ["background", "borders", "borderTop", "borderRight", "borderBottom", "borderLeft", "textColor", "verticalAlign"] as const;
const cellStyleAttrs = (node: SmartElementNode | null | undefined): Attrs => {
  const attrs = node?.attrs;
  if (!attrs) return {};
  return Object.fromEntries(CELL_STYLE_ATTR_KEYS.filter((key) => attrs[key] !== undefined).map((key) => [key, attrs[key]]));
};

/**
 * Cell placeholders are empty paragraphs inserted to keep a cell editable.
 * They must not become stacked lines when several cells are merged. Atomic
 * content remains meaningful even when it has no text descendants.
 */
const hasMeaningfulContent = (node: SmartNode, ctx: TableCommandContext): boolean => {
  if (isTextNode(node)) return node.text.length > 0;
  if (ctx.schema.nodes[node.type]?.atomic) return true;
  return (node.children || []).some((child) => hasMeaningfulContent(child, ctx));
};

const locateNode = (nodeId: string, ctx: TableCommandContext) => {
  const resolved = ctx.positions.positionOf(nodeId);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node || isTextNode(node) || node.id !== nodeId) throw new Error(`Unknown or stale node ID "${nodeId}".`);
  return { node, parentPos: { path: [...resolved.pos.path], offset: resolved.pos.offset } as SmartPos };
};

const locateTable = (scope: ResolvedScope, ctx: TableCommandContext) => {
  const selected = tableScope(scope);
  if (!selected) return null;
  const located = locateNode(selected.tableId, ctx);
  if (located.node.type !== "table") return null;
  return { scope: selected, table: located.node, parentPos: located.parentPos };
};

const consumeEmptyCells = (
  cellIds: readonly string[] | undefined,
  paragraphIds: readonly string[] | undefined,
  count: number,
  header = false,
  styleAttrsFor?: (index: number) => Attrs,
) => {
  if ((cellIds?.length || 0) < count || (paragraphIds?.length || 0) < count) throw new Error(`Table command requires ${count} caller-provided cell and paragraph IDs.`);
  return Array.from({ length: count }, (_, index) => emptyCell(cellIds![index], paragraphIds![index], header, styleAttrsFor?.(index)));
};

export const insertTableCommand: TableCommand<InsertTableParams> = (_document, scope, params, ctx) => {
  const selected = blockScope(scope);
  const firstId = selected?.blockIds[0];
  if (!firstId || params.rows < 1 || params.columns < 1) return [];
  const target = locateNode(firstId, ctx);
  const total = params.rows * params.columns;
  if (params.ids.rowIds.length < params.rows || params.ids.cellIds.length < total || params.ids.paragraphIds.length < total) {
    throw new Error("table.insert requires caller-provided IDs for every row, cell, and paragraph.");
  }
  let cellIndex = 0;
  const table: SmartElementNode = {
    type: "table", id: params.ids.tableId, attrs: { columnWidths: Array(params.columns).fill(120), layout: "fixed" },
    children: Array.from({ length: params.rows }, (_, row) => ({
      type: "table_row", id: params.ids.rowIds[row], children: Array.from({ length: params.columns }, () => {
        const current = cellIndex++;
        return emptyCell(params.ids.cellIds[current], params.ids.paragraphIds[current], Boolean(params.withHeader && row === 0));
      }),
    })),
  };
  return [{ type: "insertNode", pos: { ...target.parentPos, offset: target.parentPos.offset + (params.placement === "after" ? 1 : 0) }, node: table }];
};

export const removeTableCommand: TableCommand<Record<string, never>> = (_document, scope, _params, ctx) => {
  const target = locateTable(scope, ctx);
  return target ? [{ type: "removeNode", pos: target.parentPos, node: target.table }] : [];
};

export const insertTableRowCommand: TableCommand<RowParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const base = params.rowIndex ?? (params.position === "before" ? target.scope.rect.top : target.scope.rect.bottom + 1);
  const index = Math.max(0, Math.min(grid.rows, base));
  // A crossing anchor is always in a row strictly before `index` (its rowspan
  // reaches past `index`), so its own row position is never shifted by this
  // insertion - only its rowspan attribute needs to grow.
  const crossing = grid.anchors.filter((cell) => cell.top < index && cell.bottom > index);
  const covered = new Set<number>();
  crossing.forEach((cell) => { for (let col = cell.left; col < cell.right; col += 1) covered.add(col); });
  const columnsNeedingCell = Array.from({ length: grid.columns }, (_, column) => column).filter((column) => !covered.has(column));
  const header = index === 0 && grid.anchors.filter((cell) => cell.top === 0).every((cell) => cell.node.attrs?.header === true);
  // Inherit style from the adjacent existing row - the one immediately
  // before the insertion point (the "last row" for the common append
  // case), or immediately after it if inserting before every existing row.
  const adjacentRow = index > 0 ? index - 1 : (grid.rows > 0 ? 0 : null);
  const rowCells = consumeEmptyCells(params.cellIds, params.paragraphIds, columnsNeedingCell.length, header,
    adjacentRow === null ? undefined : (cursor) => cellStyleAttrs(grid.at(adjacentRow, columnsNeedingCell[cursor])?.node));
  if (!params.rowId) throw new Error("table.insertRow requires a caller-provided row ID.");
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const newRow: SmartElementNode = { type: "table_row", id: params.rowId, children: rowCells };
  const operations: SmartOperation[] = [{ type: "insertNode", pos: { path: tablePath, offset: index }, node: newRow }];
  crossing.forEach((cell) => {
    const before = cell.node.attrs || {};
    const after = { ...before, rowspan: (cell.bottom - cell.top) + 1 };
    operations.push({ type: "setNodeAttributes", pos: { path: [...tablePath, cell.top, cell.childIndex], offset: 0 }, before, after });
  });
  return operations;
};

export const removeTableRowCommand: TableCommand<RowParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const index = params.rowIndex ?? target.scope.rect.top;
  if (index < 0 || index >= grid.rows) return [];
  if (grid.rows === 1) return [{ type: "removeNode", pos: target.parentPos, node: target.table }];
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const doomedRow = target.table.children?.[index];
  if (!doomedRow || isTextNode(doomedRow)) return [];
  const operations: SmartOperation[] = [];

  // An anchor physically inside the doomed row whose span reaches further
  // down must relocate into the next row (which becomes this row's new
  // occupant) before the doomed row itself is removed - the row node cannot
  // simply be deleted out from under a cell that still needs to exist.
  const relocating = grid.anchors.filter((cell) => cell.top === index && cell.bottom - cell.top > 1)
    .sort((a, b) => a.childIndex - b.childIndex);
  const destinationRow = index + 1;
  const destinationAnchors = grid.anchors.filter((cell) => cell.top === destinationRow).sort((a, b) => a.left - b.left);
  relocating.forEach((cell, movedBefore) => {
    const sourceOffset = cell.childIndex - movedBefore;
    const destOffset = destinationAnchors.filter((anchor) => anchor.left < cell.left).length;
    operations.push({ type: "moveNode", from: { path: [...tablePath, index], offset: sourceOffset }, to: { path: [...tablePath, destinationRow], offset: destOffset }, nodeId: cell.cellId });
    destinationAnchors.splice(destOffset, 0, cell);
    const before = cell.node.attrs || {};
    const after = { ...before, rowspan: (cell.bottom - cell.top) - 1 };
    operations.push({ type: "setNodeAttributes", pos: { path: [...tablePath, destinationRow, destOffset], offset: 0 }, before, after });
  });

  // Anchors before the doomed row whose span crosses into it just shrink.
  grid.anchors.filter((cell) => cell.top < index && cell.bottom > index).forEach((cell) => {
    const before = cell.node.attrs || {};
    const after = { ...before, rowspan: (cell.bottom - cell.top) - 1 };
    operations.push({ type: "setNodeAttributes", pos: { path: [...tablePath, cell.top, cell.childIndex], offset: 0 }, before, after });
  });

  const relocatedIds = new Set(relocating.map((cell) => cell.cellId));
  const remainingChildren = (doomedRow.children || []).filter((child) => isTextNode(child) || !relocatedIds.has(child.id));
  operations.push({ type: "removeNode", pos: { path: tablePath, offset: index }, node: { ...doomedRow, children: remainingChildren } });
  return operations;
};

export const insertTableColumnCommand: TableCommand<ColumnParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const base = params.columnIndex ?? (params.position === "before" ? target.scope.rect.left : target.scope.rect.right + 1);
  const index = Math.max(0, Math.min(grid.columns, base));
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const crossing = grid.anchors.filter((cell) => cell.left < index && cell.right > index);
  const crossingIds = new Set(crossing.map((cell) => cell.cellId));
  const rowsNeedingCell = Array.from({ length: grid.rows }, (_, row) => row).filter((row) => {
    const occupant = grid.at(row, Math.min(index, Math.max(0, grid.columns - 1)));
    return !(occupant && crossingIds.has(occupant.cellId));
  });
  // Inherit style from the adjacent existing column - the one immediately
  // before the insertion point (the "last column" for the common append
  // case), or immediately after it if inserting before every existing
  // column.
  const adjacentColumn = index > 0 ? index - 1 : (grid.columns > 0 ? 0 : null);
  const cells = consumeEmptyCells(params.cellIds, params.paragraphIds, rowsNeedingCell.length, false,
    adjacentColumn === null ? undefined : (cursor) => cellStyleAttrs(grid.at(rowsNeedingCell[cursor], adjacentColumn)?.node));
  const operations: SmartOperation[] = [];
  rowsNeedingCell.forEach((row, cellIndex) => {
    // A row's insertion offset is however many of its own anchors already
    // sit left of the new column - no other op in this batch touches row
    // structure, so this position is stable regardless of op order.
    const offset = grid.anchors.filter((cell) => cell.top === row && cell.left < index).length;
    operations.push({ type: "insertNode", pos: { path: [...tablePath, row], offset }, node: cells[cellIndex] });
  });
  crossing.forEach((cell) => {
    const before = cell.node.attrs || {};
    const after = { ...before, colspan: (cell.right - cell.left) + 1 };
    operations.push({ type: "setNodeAttributes", pos: { path: [...tablePath, cell.top, cell.childIndex], offset: 0 }, before, after });
  });
  const beforeAttrs = target.table.attrs || {};
  // Only extend columnWidths when the table already has real per-column
  // data. Fabricating a full Array(columns).fill(120) for a table that
  // never had columnWidths (e.g. pasted content with no real per-<col>
  // pixel width, correctly left unset per docs/bugs/table-shrinks-after-
  // paste.md's all-or-nothing rule) makes the renderer pin the table's
  // width to that fabricated sum instead of leaving it at its natural
  // width - the same fabricated-fallback pattern docs/bugs/
  // table-resize-shrinks-table-with-no-prior-columnwidths.md fixed for
  // resize, recurring here for insert.
  if (Array.isArray(beforeAttrs.columnWidths)) {
    const widths = [...beforeAttrs.columnWidths as number[]];
    widths.splice(index, 0, widths[Math.max(0, index - 1)] || 120);
    operations.push({ type: "setNodeAttributes", pos: { path: tablePath, offset: 0 }, before: beforeAttrs, after: { ...beforeAttrs, columnWidths: widths } });
  }
  return operations;
};

export const removeTableColumnCommand: TableCommand<ColumnParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const index = params.columnIndex ?? target.scope.rect.left;
  if (index < 0 || index >= grid.columns) return [];
  if (grid.columns === 1) return [{ type: "removeNode", pos: target.parentPos, node: target.table }];
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const operations: SmartOperation[] = [];
  grid.anchors.filter((cell) => index >= cell.left && index < cell.right).forEach((cell) => {
    const colspan = cell.right - cell.left;
    if (colspan === 1) {
      operations.push({ type: "removeNode", pos: { path: [...tablePath, cell.top], offset: cell.childIndex }, node: cell.node });
    } else {
      const before = cell.node.attrs || {};
      operations.push({ type: "setNodeAttributes", pos: { path: [...tablePath, cell.top, cell.childIndex], offset: 0 }, before, after: { ...before, colspan: colspan - 1 } });
    }
  });
  const beforeAttrs = target.table.attrs || {};
  const widths = Array.isArray(beforeAttrs.columnWidths) ? (beforeAttrs.columnWidths as number[]).filter((_, column) => column !== index) : undefined;
  operations.push({ type: "setNodeAttributes", pos: { path: tablePath, offset: 0 }, before: beforeAttrs, after: cleanAttrs({ ...beforeAttrs, columnWidths: widths }) });
  return operations;
};

export const mergeTableCellsCommand: TableCommand<Record<string, never>> = (_document, scope, _params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !target.scope.rectangular) return [];
  const rect = { top: target.scope.rect.top, left: target.scope.rect.left, bottom: target.scope.rect.bottom + 1, right: target.scope.rect.right + 1 };
  const grid = occupancyGridFor(target.table);
  if (!grid.isRectangular(rect) || rect.bottom - rect.top === 1 && rect.right - rect.left === 1) return [];
  const selected = grid.anchorsIn(rect).sort((a, b) => a.top - b.top || a.left - b.left);
  const headers = new Set(selected.map((cell) => cell.node.attrs?.header === true));
  if (headers.size > 1) return [];
  const anchor = grid.at(rect.top, rect.left);
  if (!anchor || anchor.top !== rect.top || anchor.left !== rect.left) return [];
  const merged: SmartElementNode = {
    ...anchor.node,
    attrs: { ...(anchor.node.attrs || {}), rowspan: rect.bottom - rect.top, colspan: rect.right - rect.left },
    children: (() => {
      // Each source cell's content becomes its own block in the merged
      // cell - never concatenated onto one line with another cell's
      // content, however short both are. A prior version of this command
      // combined short single-paragraph cells into one shared paragraph to
      // avoid a merged row growing taller than its original single line;
      // that traded away a worse defect (a horizontal merge of "A"/"B"/"C"/
      // "D" cells silently reading as the single run "ABCD") for a cosmetic
      // one. A merged cell's height legitimately growing to fit multiple
      // real lines of content is expected, not a bug - see
      // docs/bugs/table-merge-concatenates-cell-content.md.
      const content = selected.flatMap((cell) => {
        const children = cell.node.children || [];
        // Preserve all blocks from a non-empty cell, including intentional
        // blank lines. Only an entirely empty source cell is discarded.
        return children.some((child) => hasMeaningfulContent(child, ctx)) ? children.map(cloneNode) : [];
      });
      // A merged region made entirely of empty cells still needs one editable
      // block, but never one placeholder block per source cell.
      return content.length ? content : anchor.node.children?.[0] ? [cloneNode(anchor.node.children[0])] : [];
    })(),
  };
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const operations: SmartOperation[] = [];
  // Cells other than the anchor are dropped. Several can share a row (e.g.
  // merging a 2x2 rectangle), so within each row they must be removed
  // highest-offset-first - applyOperations mutates one session sequentially,
  // and a lower removal first would invalidate a still-pending higher offset.
  const byRow = new Map<number, GridCell[]>();
  selected.filter((cell) => cell.cellId !== anchor.cellId).forEach((cell) => {
    byRow.set(cell.top, [...(byRow.get(cell.top) || []), cell]);
  });
  byRow.forEach((cells, row) => {
    [...cells].sort((a, b) => b.childIndex - a.childIndex).forEach((cell) => {
      // mergedInto marks this as a semantic merge, not a plain deletion -
      // an annotation anchored to this cell can snap to the anchor cell
      // instead of orphaning. See annotations/range.ts.
      operations.push({ type: "removeNode", pos: { path: [...tablePath, row], offset: cell.childIndex }, node: cell.node, mergedInto: anchor.node.id });
    });
  });
  // The anchor's replaceNode must be emitted last: its merged content can
  // clone a node id (e.g. a sole surviving paragraph) from a cell removed
  // above. Forward that is invisible - one batch, checked once at the end -
  // but undo replays operations one at a time, so the clone must not exist
  // yet when the removal's inverse re-creates the original with that id.
  operations.push({ type: "replaceNode", pos: { path: [...tablePath, anchor.top], offset: anchor.childIndex }, before: anchor.node, after: merged });
  return operations;
};

export const splitTableCellCommand: TableCommand<SplitCellParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const anchor = grid.at(target.scope.rect.top, target.scope.rect.left);
  if (!anchor || anchor.bottom - anchor.top === 1 && anchor.right - anchor.left === 1) return [];
  const count = (anchor.bottom - anchor.top) * (anchor.right - anchor.left) - 1;
  const cells = consumeEmptyCells(params.cellIds, params.paragraphIds, count, anchor.node.attrs?.header === true);
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const before = anchor.node.attrs || {};
  const operations: SmartOperation[] = [{
    type: "setNodeAttributes",
    pos: { path: [...tablePath, anchor.top, anchor.childIndex], offset: 0 },
    before,
    after: cleanAttrs({ ...before, rowspan: 1, colspan: 1 }),
  }];
  let cursor = 0;
  for (let row = anchor.top; row < anchor.bottom; row += 1) {
    // Every column in this row's split range was previously covered only by
    // the anchor's own span - the sole exception is the anchor's own row,
    // where the (unmoved) anchor cell itself already occupies the leftmost
    // slot, so new siblings land immediately after it.
    const baseOffset = row === anchor.top
      ? anchor.childIndex + 1
      : grid.anchors.filter((cell) => cell.top === row && cell.left < anchor.left).length;
    let inserted = 0;
    for (let column = anchor.left; column < anchor.right; column += 1) {
      if (row === anchor.top && column === anchor.left) continue;
      operations.push({ type: "insertNode", pos: { path: [...tablePath, row], offset: baseOffset + inserted }, node: cells[cursor++] });
      inserted += 1;
    }
  }
  return operations;
};

export const setTableHeaderCommand: TableCommand<HeaderParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  return grid.anchors.flatMap((cell): SmartOperation[] => {
    const inRows = cell.top <= target.scope.rect.bottom;
    const inColumns = cell.left <= target.scope.rect.right;
    const header = params.target === "none" ? false : params.target === "row" ? inRows : params.target === "column" ? inColumns : inRows || inColumns;
    const before = cell.node.attrs || {};
    if ((before.header === true) === header) return [];
    return [{ type: "setNodeAttributes", pos: { path: [...tablePath, cell.top, cell.childIndex], offset: 0 }, before, after: { ...before, header } }];
  });
};

export const setTableCellAttributesCommand: TableCommand<CellAttributesParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  return target.scope.cellIds.flatMap((cellId): SmartOperation[] => {
    const located = locateNode(cellId, ctx);
    const before = located.node.attrs || {};
    const after = cleanAttrs({ ...before, ...params.attrs });
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{ type: "setNodeAttributes", pos: { path: [...located.parentPos.path, located.parentPos.offset], offset: 0 }, before, after }];
  });
};

export const setTableColumnWidthCommand: TableCommand<ColumnWidthParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !Number.isFinite(params.width) || params.width < 20) return [];
  const grid = occupancyGridFor(target.table);
  if (params.index < 0 || params.index >= grid.columns) return [];
  const before = target.table.attrs || {};
  // Prefer an explicit seed (a caller that already measured real rendered
  // widths, e.g. mid-drag) over the table's own columnWidths, over a
  // fabricated 120 - see ColumnWidthParams' doc comment.
  const seed = Array.isArray(params.widths) ? params.widths : Array.isArray(before.columnWidths) ? before.columnWidths as number[] : [];
  const widths = Array.from({ length: grid.columns }, (_, index) => {
    const value = seed[index];
    return Number.isFinite(value) && (value as number) > 0 ? value as number : 120;
  });
  widths[params.index] = params.width;
  const after = { ...before, columnWidths: widths };
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ type: "setNodeAttributes", pos: { path: [...target.parentPos.path, target.parentPos.offset], offset: 0 }, before, after }];
};

export const setTableRowHeightCommand: TableCommand<RowHeightParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !Number.isFinite(params.height) || params.height < 20) return [];
  const row = target.table.children?.[params.index];
  if (!row || isTextNode(row)) return [];
  const before = row.attrs || {};
  const after = { ...before, height: params.height };
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  return [{ type: "setNodeAttributes", pos: { path: [...tablePath, params.index], offset: 0 }, before, after }];
};

export const moveTableRowCommand: TableCommand<MoveTableAxisParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !["up", "down"].includes(params.direction)) return [];
  const rows = (target.table.children || []).filter((row): row is SmartElementNode => !isTextNode(row) && row.type === "table_row");
  const index = params.index ?? target.scope.rect.top;
  const to = index + (params.direction === "up" ? -1 : 1);
  const grid = occupancyGridFor(target.table);
  if (to < 0 || to >= grid.rows || grid.anchors.some((cell) =>
    cell.top <= index && cell.bottom > index + 1 || cell.top <= to && cell.bottom > to + 1)) return [];
  const row = rows[index];
  return row ? moveContiguousSiblings([row.id], params.direction as "up" | "down", ctx) : [];
};

export const moveTableColumnCommand: TableCommand<MoveTableAxisParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !["left", "right"].includes(params.direction)) return [];
  const grid = occupancyGridFor(target.table);
  const from = params.index ?? target.scope.rect.left;
  const to = from + (params.direction === "left" ? -1 : 1);
  if (to < 0 || to >= grid.columns) return [];
  if (grid.anchors.some((cell) => (cell.left <= from && cell.right > from + 1) || (cell.left <= to && cell.right > to + 1))) return [];
  const tablePath = [...target.parentPos.path, target.parentPos.offset];
  const operations: SmartOperation[] = [];
  // Column identity is derived purely from physical ordering, never stored.
  // A row whose own anchor sits on only one side of the swap needs no op at
  // all here: once the paired anchor's row (elsewhere, for a rowspan cell)
  // is reordered, the grid walk re-derives this row's column for free.
  for (let row = 0; row < grid.rows; row += 1) {
    const atFrom = grid.anchors.find((cell) => cell.top === row && cell.left === from);
    const atTo = grid.anchors.find((cell) => cell.top === row && cell.left === to);
    if (!atFrom || !atTo) continue;
    const [earlier, later] = atFrom.childIndex < atTo.childIndex ? [atFrom, atTo] : [atTo, atFrom];
    operations.push({
      type: "moveNode",
      from: { path: [...tablePath, row], offset: earlier.childIndex },
      to: { path: [...tablePath, row], offset: later.childIndex },
      nodeId: earlier.cellId,
    });
  }
  const beforeAttrs = target.table.attrs || {};
  const widths = Array.isArray(beforeAttrs.columnWidths) ? [...beforeAttrs.columnWidths as number[]] : Array(grid.columns).fill(120);
  [widths[from], widths[to]] = [widths[to], widths[from]];
  operations.push({ type: "setNodeAttributes", pos: { path: tablePath, offset: 0 }, before: beforeAttrs, after: { ...beforeAttrs, columnWidths: widths } });
  return operations;
};

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
