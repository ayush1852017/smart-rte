import type { SmartCommand } from "../command.js";
import {
  getNodeAtPath,
  paragraph,
  type Path,
  type SmartTableCellNode,
  type SmartTableNode,
  type SmartTableRowNode,
} from "../model.js";
import { isSmartContainer } from "../tree.js";

const cell = (header = false): SmartTableCellNode => ({
  type: header ? "tableHeaderCell" : "tableCell",
  children: [paragraph()],
});

const tableAt = (document: Parameters<SmartCommand["isEnabled"]>[0]["document"], path: Path) => {
  const node = getNodeAtPath(document, path) as SmartTableNode | undefined;
  return node?.type === "table" ? node : null;
};

interface CellPlacement {
  rowIndex: number;
  cellIndex: number;
  row: number;
  column: number;
  rowspan: number;
  colspan: number;
  cell: SmartTableCellNode;
}

interface TableGrid {
  placements: CellPlacement[];
  slots: (CellPlacement | undefined)[][];
  width: number;
}

const buildTableGrid = (table: SmartTableNode): TableGrid | null => {
  const placements: CellPlacement[] = [];
  const slots: (CellPlacement | undefined)[][] = [];
  let width = 0;
  for (let rowIndex = 0; rowIndex < table.children.length; rowIndex += 1) {
    const row = table.children[rowIndex];
    slots[rowIndex] ||= [];
    let column = 0;
    for (let cellIndex = 0; cellIndex < row.children.length; cellIndex += 1) {
      while (slots[rowIndex][column]) column += 1;
      const current = row.children[cellIndex];
      const rowspan = current.rowspan || 1;
      const colspan = current.colspan || 1;
      if (rowIndex + rowspan > table.children.length) return null;
      const placement = { rowIndex, cellIndex, row: rowIndex, column, rowspan, colspan, cell: current };
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        slots[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          const slotRow = rowIndex + rowOffset;
          const slotColumn = column + columnOffset;
          if (slots[slotRow][slotColumn]) return null;
          slots[slotRow][slotColumn] = placement;
        }
      }
      placements.push(placement);
      column += colspan;
    }
    width = Math.max(width, slots[rowIndex].length);
  }
  if (!width || slots.some((row) => row.length !== width || row.some((slot) => !slot))) return null;
  return { placements, slots, width };
};

const withSpan = (
  source: SmartTableCellNode,
  rowspan: number,
  colspan: number,
): SmartTableCellNode => {
  const { rowspan: _rowspan, colspan: _colspan, ...rest } = source;
  return {
    ...rest,
    ...(rowspan > 1 ? { rowspan } : {}),
    ...(colspan > 1 ? { colspan } : {}),
  };
};

interface OutputPlacement {
  row: number;
  column: number;
  rowspan: number;
  colspan: number;
  cell: SmartTableCellNode;
}

const tableFromPlacements = (
  source: SmartTableNode,
  rowCount: number,
  placements: readonly OutputPlacement[],
): SmartTableNode => ({
  ...source,
  children: Array.from({ length: rowCount }, (_, row) => ({
    type: "tableRow",
    children: placements
      .filter((placement) => placement.row === row)
      .sort((left, right) => left.column - right.column)
      .map((placement) => withSpan(placement.cell, placement.rowspan, placement.colspan)),
  })),
});

const replaceTableTransaction = (
  context: Parameters<SmartCommand["execute"]>[0],
  id: string,
  tablePath: Path,
  table: SmartTableNode,
) => ({
  id,
  source: "user" as const,
  operations: [{ type: "replaceNode" as const, path: tablePath, node: table }],
  selectionBefore: context.selection,
  selectionAfter: { type: "node" as const, path: tablePath },
  addToHistory: true,
  timestamp: context.now?.() ?? Date.now(),
});

export interface InsertTableInput {
  path: Path;
  rows: number;
  columns: number;
  headerRow?: boolean;
}

export const insertTable: SmartCommand<InsertTableInput> = {
  id: "table.insert",
  isEnabled: (context, input) => {
    if (!input || !Number.isInteger(input.rows) || !Number.isInteger(input.columns) ||
      input.rows < 1 || input.columns < 1) return false;
    const parent = getNodeAtPath(context.document, input.path.slice(0, -1));
    const index = input.path[input.path.length - 1];
    const type = (parent as { type?: string } | undefined)?.type;
    return input.path.length > 0 && isSmartContainer(parent) &&
      ["doc", "listItem", "blockquote", "tableCell", "tableHeaderCell"].includes(type || "") &&
      index >= 0 && index <= parent.children.length;
  },
  execute: (context, input) => {
    if (!input || !insertTable.isEnabled(context, input)) {
      throw new Error("table.insert requires positive dimensions and a block insertion path.");
    }
    const node: SmartTableNode = {
      type: "table",
      children: Array.from({ length: input.rows }, (_, row) => ({
        type: "tableRow",
        children: Array.from({ length: input.columns }, () => cell(Boolean(input.headerRow && row === 0))),
      })),
    };
    return {
      id: "table.insert",
      source: "user",
      operations: [{ type: "insertNode", path: input.path, node }],
      selectionBefore: context.selection,
      selectionAfter: {
        type: "text",
        anchor: { path: [...input.path, 0, 0, 0, 0], offset: 0 },
        focus: { path: [...input.path, 0, 0, 0, 0], offset: 0 },
      },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export interface RemoveTableInput {
  tablePath: Path;
}

export const removeTable: SmartCommand<RemoveTableInput> = {
  id: "table.remove",
  isEnabled: (context, input) => Boolean(input && tableAt(context.document, input.tablePath)),
  execute: (context, input) => {
    if (!input || !removeTable.isEnabled(context, input)) {
      throw new Error("table.remove requires a valid table path.");
    }
    return {
      id: "table.remove",
      source: "user",
      operations: [{ type: "removeNode" as const, path: input.tablePath }],
      selectionBefore: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export interface TableHeaderInput {
  tablePath: Path;
  row: number;
  column: number;
}

export type TableHeaderScope = "cell" | "row" | "column";

const headerTarget = (
  context: Parameters<SmartCommand<TableHeaderInput>["isEnabled"]>[0],
  input: TableHeaderInput | undefined,
  scope: TableHeaderScope,
) => {
  const table = input && tableAt(context.document, input.tablePath);
  const grid = table && buildTableGrid(table);
  if (!input || !table || !grid || !grid.slots[input.row]?.[input.column]) return null;
  const placements = scope === "cell"
    ? [grid.slots[input.row][input.column]!]
    : scope === "row"
      ? grid.placements.filter((placement) =>
          placement.row <= input.row && placement.row + placement.rowspan > input.row)
      : grid.placements.filter((placement) =>
          placement.column <= input.column && placement.column + placement.colspan > input.column);
  return { table, grid, placements: [...new Set(placements)] };
};

const createToggleTableHeader = (
  id: `table.header.${TableHeaderScope}.toggle`,
  scope: TableHeaderScope,
): SmartCommand<TableHeaderInput> => ({
  id,
  isEnabled: (context, input) => Boolean(headerTarget(context, input, scope)),
  execute: (context, input) => {
    const target = headerTarget(context, input, scope);
    if (!input || !target) throw new Error(`${id} requires a valid logical table cell.`);
    const selected = new Set(target.placements);
    const makeHeader = target.placements.some(({ cell }) => cell.type !== "tableHeaderCell");
    const placements: OutputPlacement[] = target.grid.placements.map((placement) => ({
      row: placement.row,
      column: placement.column,
      rowspan: placement.rowspan,
      colspan: placement.colspan,
      cell: selected.has(placement)
        ? { ...placement.cell, type: makeHeader ? "tableHeaderCell" : "tableCell" }
        : placement.cell,
    }));
    return replaceTableTransaction(
      context,
      id,
      input.tablePath,
      tableFromPlacements(target.table, target.table.children.length, placements),
    );
  },
});

export const toggleTableHeaderCell = createToggleTableHeader("table.header.cell.toggle", "cell");
export const toggleTableHeaderRow = createToggleTableHeader("table.header.row.toggle", "row");
export const toggleTableHeaderColumn = createToggleTableHeader("table.header.column.toggle", "column");

export interface SetTableCellStyleInput {
  tablePath: Path;
  start: { row: number; column: number };
  end?: { row: number; column: number };
  backgroundColor?: string | null;
  textColor?: string | null;
}

const cellStyleTarget = (
  context: Parameters<SmartCommand<SetTableCellStyleInput>["isEnabled"]>[0],
  input?: SetTableCellStyleInput,
) => {
  const table = input && tableAt(context.document, input.tablePath);
  const grid = table && buildTableGrid(table);
  if (!input || !table || !grid) return null;
  const end = input.end || input.start;
  const top = Math.min(input.start.row, end.row);
  const bottom = Math.max(input.start.row, end.row);
  const left = Math.min(input.start.column, end.column);
  const right = Math.max(input.start.column, end.column);
  if (top < 0 || left < 0 || bottom >= table.children.length || right >= grid.width) return null;
  const placements = grid.placements.filter((placement) =>
    placement.row <= bottom &&
    placement.row + placement.rowspan > top &&
    placement.column <= right &&
    placement.column + placement.colspan > left);
  return placements.length ? { table, grid, placements } : null;
};

export const setTableCellStyle: SmartCommand<SetTableCellStyleInput> = {
  id: "table.cell.style.set",
  isEnabled: (context, input) => Boolean(
    cellStyleTarget(context, input) &&
    (input?.backgroundColor !== undefined || input?.textColor !== undefined)
  ),
  execute: (context, input) => {
    const target = cellStyleTarget(context, input);
    if (!input || !target || !setTableCellStyle.isEnabled(context, input)) {
      throw new Error("table.cell.style.set requires a valid logical cell range and style.");
    }
    const selected = new Set(target.placements);
    const placements: OutputPlacement[] = target.grid.placements.map((placement) => {
      if (!selected.has(placement)) return placement;
      const styled: SmartTableCellNode = { ...placement.cell };
      if (input.backgroundColor !== undefined) {
        if (input.backgroundColor) styled.backgroundColor = input.backgroundColor;
        else delete styled.backgroundColor;
      }
      if (input.textColor !== undefined) {
        if (input.textColor) styled.textColor = input.textColor;
        else delete styled.textColor;
      }
      return { ...placement, cell: styled };
    });
    return replaceTableTransaction(
      context,
      "table.cell.style.set",
      input.tablePath,
      tableFromPlacements(target.table, target.table.children.length, placements),
    );
  },
};

export interface ToggleTableCellBorderInput {
  tablePath: Path;
  start: { row: number; column: number };
  end?: { row: number; column: number };
  visibleBorder?: string;
}

export const toggleTableCellBorder: SmartCommand<ToggleTableCellBorderInput> = {
  id: "table.cell.border.toggle",
  isEnabled: (context, input) => Boolean(cellStyleTarget(context, input)),
  execute: (context, input) => {
    const target = cellStyleTarget(context, input);
    if (!input || !target) {
      throw new Error("table.cell.border.toggle requires a valid logical cell range.");
    }
    const selected = new Set(target.placements);
    const placements: OutputPlacement[] = target.grid.placements.map((placement) => {
      if (!selected.has(placement)) return placement;
      const border = placement.cell.border && placement.cell.border !== "none"
        ? "none"
        : input.visibleBorder || "1px solid #d1d5db";
      return { ...placement, cell: { ...placement.cell, border } };
    });
    return replaceTableTransaction(
      context,
      "table.cell.border.toggle",
      input.tablePath,
      tableFromPlacements(target.table, target.table.children.length, placements),
    );
  },
};

export interface SetTableColumnWidthInput {
  tablePath: Path;
  index: number;
  widthPx: number;
}

export const setTableColumnWidth: SmartCommand<SetTableColumnWidthInput> = {
  id: "table.column.width.set",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    const width = table ? buildTableGrid(table)?.width || 0 : 0;
    return Boolean(input && table && Number.isInteger(input.index) && input.index >= 0 &&
      input.index < width && Number.isFinite(input.widthPx) && input.widthPx >= 60);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !setTableColumnWidth.isEnabled(context, input)) {
      throw new Error("table.column.width.set requires a valid logical column and width.");
    }
    const gridWidth = buildTableGrid(table)!.width;
    const widths = Array.from({ length: gridWidth }, (_, index) =>
      table.columnWidths?.[index] || 60);
    widths[input.index] = input.widthPx;
    return replaceTableTransaction(context, "table.column.width.set", input.tablePath, {
      ...table,
      columnWidths: widths,
    });
  },
};

export interface SetTableRowHeightInput {
  tablePath: Path;
  index: number;
  heightPx: number;
}

export const setTableRowHeight: SmartCommand<SetTableRowHeightInput> = {
  id: "table.row.height.set",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    return Boolean(input && table && Number.isInteger(input.index) && input.index >= 0 &&
      input.index < table.children.length && Number.isFinite(input.heightPx) && input.heightPx >= 30);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !setTableRowHeight.isEnabled(context, input)) {
      throw new Error("table.row.height.set requires a valid row and height.");
    }
    return replaceTableTransaction(context, "table.row.height.set", input.tablePath, {
      ...table,
      children: table.children.map((row, index) =>
        index === input.index ? { ...row, heightPx: input.heightPx } : row),
    });
  },
};

export interface TableRowInput {
  tablePath: Path;
  index: number;
}

export const addTableRow: SmartCommand<TableRowInput> = {
  id: "table.row.add",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    return Boolean(table && Number.isInteger(input!.index) && input!.index >= 0 && input!.index <= table.children.length);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !addTableRow.isEnabled(context, input)) throw new Error("table.row.add requires a valid table row index.");
    const grid = buildTableGrid(table);
    if (!grid) throw new Error("table.row.add requires a valid rectangular table grid.");
    const crossing = new Set(grid.placements.filter((placement) =>
      placement.row < input.index && placement.row + placement.rowspan > input.index));
    const placements: OutputPlacement[] = grid.placements.map((placement) => ({
      row: placement.row >= input.index ? placement.row + 1 : placement.row,
      column: placement.column,
      rowspan: placement.rowspan + (crossing.has(placement) ? 1 : 0),
      colspan: placement.colspan,
      cell: placement.cell,
    }));
    const covered = new Set<number>();
    crossing.forEach((placement) => {
      for (let column = placement.column; column < placement.column + placement.colspan; column += 1) {
        covered.add(column);
      }
    });
    const header = input.index === 0 && table.children[0]?.children.every((candidate) =>
      candidate.type === "tableHeaderCell");
    for (let column = 0; column < grid.width; column += 1) {
      if (!covered.has(column)) {
        placements.push({ row: input.index, column, rowspan: 1, colspan: 1, cell: cell(header) });
      }
    }
    return replaceTableTransaction(
      context,
      "table.row.add",
      input.tablePath,
      tableFromPlacements(table, table.children.length + 1, placements),
    );
  },
};

export const removeTableRow: SmartCommand<TableRowInput> = {
  id: "table.row.remove",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    return Boolean(table && table.children.length > 1 && Number.isInteger(input!.index) &&
      input!.index >= 0 && input!.index < table.children.length);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !removeTableRow.isEnabled(context, input)) {
      throw new Error("table.row.remove cannot remove this row.");
    }
    const grid = buildTableGrid(table);
    if (!grid) throw new Error("table.row.remove requires a valid rectangular table grid.");
    const placements: OutputPlacement[] = grid.placements.flatMap((placement) => {
      const bottom = placement.row + placement.rowspan;
      if (placement.row === input.index && placement.rowspan === 1) return [];
      const crosses = placement.row < input.index && bottom > input.index;
      const startsOnRemovedRow = placement.row === input.index && placement.rowspan > 1;
      return [{
        row: placement.row > input.index ? placement.row - 1 : placement.row,
        column: placement.column,
        rowspan: placement.rowspan - (crosses || startsOnRemovedRow ? 1 : 0),
        colspan: placement.colspan,
        cell: placement.cell,
      }];
    });
    return replaceTableTransaction(
      context,
      "table.row.remove",
      input.tablePath,
      tableFromPlacements(table, table.children.length - 1, placements),
    );
  },
};

export interface TableColumnInput {
  tablePath: Path;
  index: number;
}

export const addTableColumn: SmartCommand<TableColumnInput> = {
  id: "table.column.add",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    const width = table ? buildTableGrid(table)?.width || 0 : 0;
    return Boolean(table && Number.isInteger(input!.index) && input!.index >= 0 && input!.index <= width);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !addTableColumn.isEnabled(context, input)) {
      throw new Error("table.column.add requires a valid table column index.");
    }
    const grid = buildTableGrid(table);
    if (!grid) throw new Error("table.column.add requires a valid rectangular table grid.");
    const crossing = new Set(grid.placements.filter((placement) =>
      placement.column < input.index && placement.column + placement.colspan > input.index));
    const placements: OutputPlacement[] = grid.placements.map((placement) => ({
      row: placement.row,
      column: placement.column >= input.index ? placement.column + 1 : placement.column,
      rowspan: placement.rowspan,
      colspan: placement.colspan + (crossing.has(placement) ? 1 : 0),
      cell: placement.cell,
    }));
    for (let row = 0; row < table.children.length; row += 1) {
      const occupied = grid.slots[row][input.index];
      if (occupied && crossing.has(occupied)) continue;
      const header = table.children[row].children.every((candidate) =>
        candidate.type === "tableHeaderCell");
      placements.push({ row, column: input.index, rowspan: 1, colspan: 1, cell: cell(header) });
    }
    return replaceTableTransaction(
      context,
      "table.column.add",
      input.tablePath,
      tableFromPlacements({
        ...table,
        columnWidths: table.columnWidths
          ? [
              ...table.columnWidths.slice(0, input.index),
              table.columnWidths[Math.max(0, input.index - 1)] || 60,
              ...table.columnWidths.slice(input.index),
            ]
          : undefined,
      }, table.children.length, placements),
    );
  },
};

export const removeTableColumn: SmartCommand<TableColumnInput> = {
  id: "table.column.remove",
  isEnabled: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    const width = table ? buildTableGrid(table)?.width || 0 : 0;
    return Boolean(table && width > 1 && Number.isInteger(input!.index) &&
      input!.index >= 0 && input!.index < width);
  },
  execute: (context, input) => {
    const table = input && tableAt(context.document, input.tablePath);
    if (!input || !table || !removeTableColumn.isEnabled(context, input)) {
      throw new Error("table.column.remove cannot remove this column.");
    }
    const grid = buildTableGrid(table);
    if (!grid) throw new Error("table.column.remove requires a valid rectangular table grid.");
    const placements: OutputPlacement[] = grid.placements.flatMap((placement) => {
      const right = placement.column + placement.colspan;
      if (input.index >= placement.column && input.index < right) {
        if (placement.colspan === 1) return [];
        return [{
          row: placement.row,
          column: placement.column,
          rowspan: placement.rowspan,
          colspan: placement.colspan - 1,
          cell: placement.cell,
        }];
      }
      return [{
        row: placement.row,
        column: placement.column > input.index ? placement.column - 1 : placement.column,
        rowspan: placement.rowspan,
        colspan: placement.colspan,
        cell: placement.cell,
      }];
    });
    return replaceTableTransaction(
      context,
      "table.column.remove",
      input.tablePath,
      tableFromPlacements({
        ...table,
        columnWidths: table.columnWidths
          ? table.columnWidths.filter((_, index) => index !== input.index)
          : undefined,
      }, table.children.length, placements),
    );
  },
};

export interface MergeTableCellsInput {
  tablePath: Path;
  start: { row: number; column: number };
  end: { row: number; column: number };
}

const mergeRegion = (input: MergeTableCellsInput) => ({
  top: Math.min(input.start.row, input.end.row),
  bottom: Math.max(input.start.row, input.end.row),
  left: Math.min(input.start.column, input.end.column),
  right: Math.max(input.start.column, input.end.column),
});

const mergeTarget = (
  context: Parameters<SmartCommand<MergeTableCellsInput>["isEnabled"]>[0],
  input?: MergeTableCellsInput,
) => {
  const table = input && tableAt(context.document, input.tablePath);
  const grid = table && buildTableGrid(table);
  if (!input || !table || !grid) return null;
  const region = mergeRegion(input);
  if (
    region.top < 0 || region.left < 0 ||
    region.bottom >= table.children.length || region.right >= grid.width ||
    region.top === region.bottom && region.left === region.right
  ) return null;
  const selected = grid.placements.filter((placement) =>
    placement.row <= region.bottom &&
    placement.row + placement.rowspan - 1 >= region.top &&
    placement.column <= region.right &&
    placement.column + placement.colspan - 1 >= region.left);
  if (!selected.length || selected.some((placement) =>
    placement.row < region.top ||
    placement.column < region.left ||
    placement.row + placement.rowspan - 1 > region.bottom ||
    placement.column + placement.colspan - 1 > region.right
  )) return null;
  const anchor = grid.slots[region.top]?.[region.left];
  if (!anchor || anchor.row !== region.top || anchor.column !== region.left) return null;
  return { table, grid, region, selected, anchor };
};

export const mergeTableCells: SmartCommand<MergeTableCellsInput> = {
  id: "table.cell.merge",
  isEnabled: (context, input) => Boolean(mergeTarget(context, input)),
  execute: (context, input) => {
    const target = mergeTarget(context, input);
    if (!input || !target) {
      throw new Error("table.cell.merge requires a valid rectangular cell selection.");
    }
    const selectedKeys = new Set(target.selected.map(({ rowIndex, cellIndex }) => `${rowIndex}:${cellIndex}`));
    const ordered = [...target.selected].sort((left, right) =>
      left.row - right.row || left.column - right.column);
    const mergedCell: SmartTableCellNode = {
      ...target.anchor.cell,
      colspan: target.region.right - target.region.left + 1,
      rowspan: target.region.bottom - target.region.top + 1,
      children: ordered.flatMap((placement) => placement.cell.children),
    };
    if (mergedCell.colspan === 1) delete mergedCell.colspan;
    if (mergedCell.rowspan === 1) delete mergedCell.rowspan;
    const rows: SmartTableRowNode[] = target.table.children.map((row, rowIndex) => ({
      ...row,
      children: row.children.flatMap((current, cellIndex) => {
        const key = `${rowIndex}:${cellIndex}`;
        if (!selectedKeys.has(key)) return [current];
        return rowIndex === target.anchor.rowIndex && cellIndex === target.anchor.cellIndex
          ? [mergedCell]
          : [];
      }),
    }));
    return replaceTableTransaction(context, "table.cell.merge", input.tablePath, {
      ...target.table,
      children: rows,
    });
  },
};

export interface SplitTableCellInput {
  tablePath: Path;
  row: number;
  column: number;
}

const splitTarget = (
  context: Parameters<SmartCommand<SplitTableCellInput>["isEnabled"]>[0],
  input?: SplitTableCellInput,
) => {
  const table = input && tableAt(context.document, input.tablePath);
  const grid = table && buildTableGrid(table);
  const placement = input && grid?.slots[input.row]?.[input.column];
  return table && grid && placement && (placement.rowspan > 1 || placement.colspan > 1)
    ? { table, grid, placement }
    : null;
};

export const splitTableCell: SmartCommand<SplitTableCellInput> = {
  id: "table.cell.split",
  isEnabled: (context, input) => Boolean(splitTarget(context, input)),
  execute: (context, input) => {
    const target = splitTarget(context, input);
    if (!input || !target) throw new Error("table.cell.split requires a merged cell.");
    const replacementPlacements: CellPlacement[] = [];
    for (let row = target.placement.row; row < target.placement.row + target.placement.rowspan; row += 1) {
      for (let column = target.placement.column; column < target.placement.column + target.placement.colspan; column += 1) {
        replacementPlacements.push({
          rowIndex: row,
          cellIndex: 0,
          row,
          column,
          rowspan: 1,
          colspan: 1,
          cell: row === target.placement.row && column === target.placement.column
            ? {
              type: target.placement.cell.type,
              children: target.placement.cell.children,
            }
            : cell(target.placement.cell.type === "tableHeaderCell"),
        });
      }
    }
    const placements = target.grid.placements
      .filter((placement) => placement !== target.placement)
      .concat(replacementPlacements);
    const rows: SmartTableRowNode[] = target.table.children.map((row, rowIndex) => ({
      ...row,
      children: placements
        .filter((placement) => placement.row === rowIndex)
        .sort((left, right) => left.column - right.column)
        .map((placement) => placement.cell),
    }));
    return replaceTableTransaction(context, "table.cell.split", input.tablePath, {
      ...target.table,
      children: rows,
    });
  },
};
