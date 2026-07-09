import type { Path, SmartDocument } from "./model.js";

export interface SmartContainer {
  children: unknown[];
}

export const isSmartContainer = (value: unknown): value is SmartContainer =>
  Boolean(value) && typeof value === "object" && Array.isArray((value as SmartContainer).children);

export const replaceNodeAtPath = <T>(
  document: SmartDocument,
  path: Path,
  replacement: T
): SmartDocument => {
  if (path.length === 0) return replacement as SmartDocument;

  const replace = (node: unknown, depth: number): unknown => {
    if (!isSmartContainer(node)) throw new Error("Path does not resolve to a document container.");
    const index = path[depth];
    if (index < 0 || index >= node.children.length) throw new Error("Path is out of bounds.");
    const children = [...node.children];
    children[index] = depth === path.length - 1
      ? replacement
      : replace(children[index], depth + 1);
    return { ...(node as object), children };
  };

  return replace(document, 0) as SmartDocument;
};
