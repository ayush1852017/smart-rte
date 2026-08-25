import { definePluginCommand, type ContextMenuContribution, type PluginCommand } from "../plugin/types.js";
import { tableCommands } from "./commands.js";

/**
 * Wraps the fourteen existing, already-tested table commands
 * (table/commands.ts's tableCommands) with the description Phase 10's doc
 * generation needs. Every one already emits Phase 8c's fine-grained
 * operations (insertNode/removeNode/moveNode/setNodeAttributes scoped to
 * the affected row/cell, plus a cell-scoped replaceNode for merge) - this
 * wrap does not touch that, it only adds metadata around commands that are
 * already, individually, exactly what a PluginCommand's `run` needs.
 */
export const tablePluginCommands: Record<string, PluginCommand> = {
  "table.insert": definePluginCommand({
    id: "table.insert", run: tableCommands["table.insert"],
    description: "Inserts a new table with the given row/column count at the current position.",
    options: {
      rows: { description: "Number of rows.", required: true },
      columns: { description: "Number of columns.", required: true },
      withHeader: { description: "Whether the first row is a header row." },
      placement: { description: "\"before\" or \"after\" the current block." },
      ids: { description: "Caller-provided ids for the table, its rows, cells, and paragraphs.", required: true },
    },
  }),
  "table.remove": definePluginCommand({
    id: "table.remove", run: tableCommands["table.remove"],
    description: "Removes the selected table entirely.",
  }),
  "table.insertRow": definePluginCommand({
    id: "table.insertRow", run: tableCommands["table.insertRow"],
    description: "Inserts a new row into the selected table, bumping the rowspan of any cell whose span crosses the insertion point.",
    options: {
      position: { description: "\"before\" or \"after\" the current row." },
      rowIndex: { description: "Explicit row index to insert at, instead of relative to the current row." },
      rowId: { description: "Caller-provided id for the new row.", required: true },
      cellIds: { description: "Caller-provided ids for the new row's cells." },
      paragraphIds: { description: "Caller-provided ids for the new cells' paragraphs." },
    },
  }),
  "table.removeRow": definePluginCommand({
    id: "table.removeRow", run: tableCommands["table.removeRow"],
    description: "Removes a row from the selected table, relocating any cell anchored there whose rowspan reaches further down.",
    options: { rowIndex: { description: "The row index to remove; defaults to the current row." } },
  }),
  "table.insertColumn": definePluginCommand({
    id: "table.insertColumn", run: tableCommands["table.insertColumn"],
    description: "Inserts a new column into the selected table, one operation per affected row.",
    options: {
      position: { description: "\"before\" or \"after\" the current column." },
      columnIndex: { description: "Explicit column index to insert at." },
      cellIds: { description: "Caller-provided ids for the new column's cells, one per row needing one." },
      paragraphIds: { description: "Caller-provided ids for the new cells' paragraphs." },
    },
  }),
  "table.removeColumn": definePluginCommand({
    id: "table.removeColumn", run: tableCommands["table.removeColumn"],
    description: "Removes a column from the selected table, one operation per affected row.",
    options: { columnIndex: { description: "The column index to remove; defaults to the current column." } },
  }),
  "table.mergeCells": definePluginCommand({
    id: "table.mergeCells", run: tableCommands["table.mergeCells"],
    description: "Merges the selected rectangular cell range into one cell, concatenating simple inline content or preserving block content.",
  }),
  "table.splitCell": definePluginCommand({
    id: "table.splitCell", run: tableCommands["table.splitCell"],
    description: "Splits a previously-merged cell back into its individual cells.",
    options: { cellIds: { description: "Caller-provided ids for the newly-created cells.", required: true }, paragraphIds: { description: "Caller-provided ids for the new cells' paragraphs.", required: true } },
  }),
  "table.setHeader": definePluginCommand({
    id: "table.setHeader", run: tableCommands["table.setHeader"],
    description: "Sets which leading rows and/or columns of the table are headers.",
    options: { target: { description: "\"row\", \"column\", \"both\", or \"none\".", required: true } },
  }),
  "table.setCellAttributes": definePluginCommand({
    id: "table.setCellAttributes", run: tableCommands["table.setCellAttributes"],
    description: "Sets attributes on the selected cell(s).",
    options: { attrs: { description: "The attributes to set.", required: true } },
  }),
  "table.setColumnWidth": definePluginCommand({
    id: "table.setColumnWidth", run: tableCommands["table.setColumnWidth"],
    description: "Sets a single column's width.",
    options: { index: { description: "The column index.", required: true }, width: { description: "The new width in pixels.", required: true } },
  }),
  "table.setRowHeight": definePluginCommand({
    id: "table.setRowHeight", run: tableCommands["table.setRowHeight"],
    description: "Sets a single row's height.",
    options: { index: { description: "The row index.", required: true }, height: { description: "The new height in pixels.", required: true } },
  }),
  "table.moveRow": definePluginCommand({
    id: "table.moveRow", run: tableCommands["table.moveRow"],
    description: "Moves a row up or down, refusing moves that would split a rowspan.",
    options: { direction: { description: "\"up\" or \"down\".", required: true }, index: { description: "The row index; defaults to the current row." } },
  }),
  "table.moveColumn": definePluginCommand({
    id: "table.moveColumn", run: tableCommands["table.moveColumn"],
    description: "Moves a column left or right, refusing moves that would split a colspan.",
    options: { direction: { description: "\"left\" or \"right\".", required: true }, index: { description: "The column index; defaults to the current column." } },
  }),
};

/**
 * Phase 11.5 §2.3: table.insertRow/table.insertColumn need caller-generated
 * ids (rowId/cellIds/paragraphIds) that can't live in a static `params` -
 * the dispatching UI must merge fresh ids in at invocation time, the same
 * way surface/input.ts's Tab handling special-cases list.indent/outdent's
 * dynamic params. table.splitCell has the same requirement plus only
 * applies to an already-merged cell, which needs more than a scope-kind
 * check to detect - left out of this first pass rather than shown
 * unconditionally. table.setHeader/moveRow/moveColumn already have
 * dedicated toolbar buttons; not duplicated here.
 */
export const tableContextMenuContributions: readonly ContextMenuContribution[] = [
  { id: "table.contextMenu.insertRowAbove", commandId: "table.insertRow", params: { position: "before" }, label: "Insert row above", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.insertRowBelow", commandId: "table.insertRow", params: { position: "after" }, label: "Insert row below", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.removeRow", commandId: "table.removeRow", label: "Delete row", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.insertColumnLeft", commandId: "table.insertColumn", params: { position: "before" }, label: "Insert column left", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.insertColumnRight", commandId: "table.insertColumn", params: { position: "after" }, label: "Insert column right", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.removeColumn", commandId: "table.removeColumn", label: "Delete column", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.mergeCells", commandId: "table.mergeCells", label: "Merge cells", scopeKinds: ["table-grid"] },
  { id: "table.contextMenu.removeTable", commandId: "table.remove", label: "Delete table", scopeKinds: ["table-grid"] },
];
