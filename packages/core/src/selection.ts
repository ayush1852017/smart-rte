import type { Path } from "./model.js";

export interface SmartPoint {
  path: Path;
  offset: number;
}

export interface SmartTextSelection {
  type: "text";
  anchor: SmartPoint;
  focus: SmartPoint;
}

export interface SmartNodeSelection {
  type: "node";
  path: Path;
}

export interface SmartCellSelection {
  type: "cell";
  tablePath: Path;
  start: { row: number; column: number };
  end: { row: number; column: number };
}

export interface SmartAllSelection {
  type: "all";
}

export type LegacySmartSelection =
  | SmartTextSelection
  | SmartNodeSelection
  | SmartCellSelection
  | SmartAllSelection;
