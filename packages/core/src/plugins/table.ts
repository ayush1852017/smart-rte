import {
  addTableColumn,
  addTableRow,
  insertTable,
  mergeTableCells,
  removeTable,
  removeTableColumn,
  removeTableRow,
  setTableCellStyle,
  setTableColumnWidth,
  setTableRowHeight,
  splitTableCell,
  toggleTableHeaderCell,
  toggleTableHeaderColumn,
  toggleTableHeaderRow,
  toggleTableCellBorder,
} from "../commands/table.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createTablePlugin = (): SmartRtePlugin => ({
  id: "table",
  commands: {
    [insertTable.id]: insertTable,
    [removeTable.id]: removeTable,
    [addTableRow.id]: addTableRow,
    [removeTableRow.id]: removeTableRow,
    [addTableColumn.id]: addTableColumn,
    [removeTableColumn.id]: removeTableColumn,
    [setTableCellStyle.id]: setTableCellStyle,
    [setTableColumnWidth.id]: setTableColumnWidth,
    [setTableRowHeight.id]: setTableRowHeight,
    [mergeTableCells.id]: mergeTableCells,
    [splitTableCell.id]: splitTableCell,
    [toggleTableHeaderCell.id]: toggleTableHeaderCell,
    [toggleTableHeaderRow.id]: toggleTableHeaderRow,
    [toggleTableHeaderColumn.id]: toggleTableHeaderColumn,
    [toggleTableCellBorder.id]: toggleTableCellBorder,
  },
});

export const tablePlugin = createTablePlugin();
