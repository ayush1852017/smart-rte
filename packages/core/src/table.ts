import { paragraph, type SmartBlockNode, type SmartTableCellNode } from "./model.js";

/** Ensures table cells have blocks even when imported HTML supplied raw lines. */
export const normalizeTableCell = (
  cell: SmartTableCellNode,
  rawLines: readonly string[] = []
): SmartTableCellNode => {
  if (cell.children.length > 0) return cell;
  return {
    ...cell,
    children: rawLines.length > 0
      ? rawLines.map((line) => paragraph(line))
      : [paragraph()],
  };
};

export const listFromBlocks = (
  blocks: readonly SmartBlockNode[],
  style: "disc" | "circle" | "square" | "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman" = "disc"
) => ({
  type: "list" as const,
  style,
  children: blocks.map((block) => ({ type: "listItem" as const, children: [block] })),
});
