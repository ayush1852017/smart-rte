import type { Attrs, SmartDocument, SmartElementNode, SmartOperation, SmartSchema } from "../types.js";
import type { PositionLookup, ResolvedScope } from "../scope/types.js";

export interface Rect {
  readonly top: number;
  readonly left: number;
  /** Exclusive. */
  readonly bottom: number;
  /** Exclusive. */
  readonly right: number;
}

export interface GridCell {
  readonly cellId: string;
  readonly top: number;
  readonly left: number;
  /** Exclusive. */
  readonly bottom: number;
  /** Exclusive. */
  readonly right: number;
  readonly isAnchor: boolean;
  readonly rowIndex: number;
  readonly childIndex: number;
  readonly node: SmartElementNode;
}

export interface OccupancyGrid {
  readonly tableId: string;
  readonly rows: number;
  readonly columns: number;
  readonly anchors: readonly GridCell[];
  at(row: number, col: number): GridCell | null;
  anchorsIn(rect: Rect): GridCell[];
  coveredIn(rect: Rect): GridCell[];
  isRectangular(rect: Rect): boolean;
}

export interface TableGeometryIssue {
  readonly code: "overlap" | "overhang" | "hole" | "unequal-width" | "noncontiguous-header" | "invalid-child";
  readonly row: number;
  readonly column?: number;
  readonly cellId?: string;
  readonly message: string;
}

export interface TableCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type TableCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: TableCommandContext,
) => SmartOperation[];

export interface TableIds {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly cellIds: readonly string[];
  readonly paragraphIds: readonly string[];
}

export interface InsertTableParams { readonly rows: number; readonly columns: number; readonly withHeader?: boolean; readonly ids: TableIds }
export interface RowParams { readonly position?: "before" | "after"; readonly rowIndex?: number; readonly rowId?: string; readonly cellIds?: readonly string[]; readonly paragraphIds?: readonly string[] }
export interface ColumnParams { readonly position?: "before" | "after"; readonly columnIndex?: number; readonly cellIds?: readonly string[]; readonly paragraphIds?: readonly string[] }
export interface HeaderParams { readonly target: "row" | "column" | "both" | "none" }
export interface CellAttributesParams { readonly attrs: Attrs }
export interface ColumnWidthParams { readonly index: number; readonly width: number }
export interface RowHeightParams { readonly index: number; readonly height: number }
export interface MoveTableAxisParams { readonly direction: "up" | "down" | "left" | "right"; readonly index?: number }
export interface SplitCellParams { readonly cellIds: readonly string[]; readonly paragraphIds: readonly string[] }

export interface CellSelectionRect {
  readonly tableId: string;
  readonly anchorCellId: string;
  readonly headCellId: string;
  readonly rect: Rect;
  readonly cellIds: readonly string[];
}
