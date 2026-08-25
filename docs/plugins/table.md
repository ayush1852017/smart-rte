# table plugin

**Version:** 1.0.0

### `table.insert`

Inserts a new table with the given row/column count at the current position.

**Options:**

| Name | Required | Description |
|---|---|---|
| `rows` | yes | Number of rows. |
| `columns` | yes | Number of columns. |
| `withHeader` | no | Whether the first row is a header row. |
| `placement` | no | "before" or "after" the current block. |
| `ids` | yes | Caller-provided ids for the table, its rows, cells, and paragraphs. |


### `table.insertColumn`

Inserts a new column into the selected table, one operation per affected row.

**Options:**

| Name | Required | Description |
|---|---|---|
| `position` | no | "before" or "after" the current column. |
| `columnIndex` | no | Explicit column index to insert at. |
| `cellIds` | no | Caller-provided ids for the new column's cells, one per row needing one. |
| `paragraphIds` | no | Caller-provided ids for the new cells' paragraphs. |


### `table.insertRow`

Inserts a new row into the selected table, bumping the rowspan of any cell whose span crosses the insertion point.

**Options:**

| Name | Required | Description |
|---|---|---|
| `position` | no | "before" or "after" the current row. |
| `rowIndex` | no | Explicit row index to insert at, instead of relative to the current row. |
| `rowId` | yes | Caller-provided id for the new row. |
| `cellIds` | no | Caller-provided ids for the new row's cells. |
| `paragraphIds` | no | Caller-provided ids for the new cells' paragraphs. |


### `table.mergeCells`

Merges the selected rectangular cell range into one cell, concatenating simple inline content or preserving block content.


### `table.moveColumn`

Moves a column left or right, refusing moves that would split a colspan.

**Options:**

| Name | Required | Description |
|---|---|---|
| `direction` | yes | "left" or "right". |
| `index` | no | The column index; defaults to the current column. |


### `table.moveRow`

Moves a row up or down, refusing moves that would split a rowspan.

**Options:**

| Name | Required | Description |
|---|---|---|
| `direction` | yes | "up" or "down". |
| `index` | no | The row index; defaults to the current row. |


### `table.remove`

Removes the selected table entirely.


### `table.removeColumn`

Removes a column from the selected table, one operation per affected row.

**Options:**

| Name | Required | Description |
|---|---|---|
| `columnIndex` | no | The column index to remove; defaults to the current column. |


### `table.removeRow`

Removes a row from the selected table, relocating any cell anchored there whose rowspan reaches further down.

**Options:**

| Name | Required | Description |
|---|---|---|
| `rowIndex` | no | The row index to remove; defaults to the current row. |


### `table.setCellAttributes`

Sets attributes on the selected cell(s).

**Options:**

| Name | Required | Description |
|---|---|---|
| `attrs` | yes | The attributes to set. |


### `table.setColumnWidth`

Sets a single column's width.

**Options:**

| Name | Required | Description |
|---|---|---|
| `index` | yes | The column index. |
| `width` | yes | The new width in pixels. |


### `table.setHeader`

Sets which leading rows and/or columns of the table are headers.

**Options:**

| Name | Required | Description |
|---|---|---|
| `target` | yes | "row", "column", "both", or "none". |


### `table.setRowHeight`

Sets a single row's height.

**Options:**

| Name | Required | Description |
|---|---|---|
| `index` | yes | The row index. |
| `height` | yes | The new height in pixels. |


### `table.splitCell`

Splits a previously-merged cell back into its individual cells.

**Options:**

| Name | Required | Description |
|---|---|---|
| `cellIds` | yes | Caller-provided ids for the newly-created cells. |
| `paragraphIds` | yes | Caller-provided ids for the new cells' paragraphs. |

