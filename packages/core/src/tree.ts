import type { Path, LegacySmartDocument } from "./model.js";

export interface SmartContainer {
  children: unknown[];
}

export const isSmartContainer = (value: unknown): value is SmartContainer =>
  Boolean(value) && typeof value === "object" && Array.isArray((value as SmartContainer).children);

export const getNodeAtTreePath = (document: LegacySmartDocument, path: Path): unknown => {
  let node: unknown = document;
  for (const index of path) {
    if (!isSmartContainer(node) || !Number.isInteger(index) || index < 0 || index >= node.children.length) {
      throw new Error("Path is out of bounds.");
    }
    node = node.children[index];
  }
  return node;
};

const parentAndIndex = (document: LegacySmartDocument, path: Path) => {
  if (path.length === 0) throw new Error("Operation path cannot target the document root.");
  const index = path[path.length - 1];
  if (!Number.isInteger(index) || index < 0) throw new Error("Path index must be a non-negative integer.");
  const parentPath = path.slice(0, -1);
  const parent = getNodeAtTreePath(document, parentPath);
  if (!isSmartContainer(parent)) throw new Error("Path does not resolve to a document container.");
  return { parent, parentPath, index };
};

export const replaceNodeAtPath = <T>(
  document: LegacySmartDocument,
  path: Path,
  replacement: T
): LegacySmartDocument => {
  if (path.length === 0) return replacement as LegacySmartDocument;

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

  return replace(document, 0) as LegacySmartDocument;
};

export const insertNodeAtPath = <T>(document: LegacySmartDocument, path: Path, node: T): LegacySmartDocument => {
  const { parent, parentPath, index } = parentAndIndex(document, path);
  if (index > parent.children.length) throw new Error("Insert path is out of bounds.");
  return replaceNodeAtPath(document, parentPath, {
    ...(parent as object),
    children: [...parent.children.slice(0, index), node, ...parent.children.slice(index)],
  });
};

export const removeNodeAtPath = (
  document: LegacySmartDocument,
  path: Path
): { document: LegacySmartDocument; node: unknown } => {
  const { parent, parentPath, index } = parentAndIndex(document, path);
  if (index >= parent.children.length) throw new Error("Remove path is out of bounds.");
  const node = parent.children[index];
  return {
    document: replaceNodeAtPath(document, parentPath, {
      ...(parent as object),
      children: [...parent.children.slice(0, index), ...parent.children.slice(index + 1)],
    }),
    node,
  };
};
