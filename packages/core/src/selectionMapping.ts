import type { Path, SmartDocument, SmartTextNode } from "./model.js";
import type { SmartPoint, SmartSelection } from "./selection.js";
import type { SmartOperation } from "./transaction.js";
import { getNodeAtTreePath, isSmartContainer } from "./tree.js";

const samePath = (left: Path, right: Path) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const hasPrefix = (path: Path, prefix: Path) =>
  path.length >= prefix.length && prefix.every((part, index) => path[index] === part);

const insertionAdjustedPath = (path: Path, insertion: Path): Path => {
  const parent = insertion.slice(0, -1);
  const depth = parent.length;
  if (!hasPrefix(path, parent) || path.length <= depth) return [...path];
  const next = [...path];
  if (next[depth] >= insertion[depth]) next[depth] += 1;
  return next;
};

const removalAdjustedPath = (path: Path, removal: Path): Path | null => {
  if (hasPrefix(path, removal)) return null;
  const parent = removal.slice(0, -1);
  const depth = parent.length;
  if (!hasPrefix(path, parent) || path.length <= depth) return [...path];
  const next = [...path];
  if (next[depth] > removal[depth]) next[depth] -= 1;
  return next;
};

const moveDestinationAfterRemoval = (from: Path, to: Path): Path => {
  const parent = from.slice(0, -1);
  const depth = parent.length;
  const next = [...to];
  if (hasPrefix(to, parent) && to.length > depth && from[depth] < to[depth]) next[depth] -= 1;
  return next;
};

const moveAdjustedPath = (path: Path, from: Path, to: Path): Path | null => {
  const destination = moveDestinationAfterRemoval(from, to);
  if (hasPrefix(path, from)) return [...destination, ...path.slice(from.length)];
  const afterRemoval = removalAdjustedPath(path, from);
  return afterRemoval ? insertionAdjustedPath(afterRemoval, destination) : null;
};

const splitAdjustedPath = (path: Path, splitPath: Path, position: number): Path => {
  const parent = splitPath.slice(0, -1);
  const depth = splitPath.length - 1;
  const rightPath = [...parent, splitPath[depth] + 1];
  if (hasPrefix(path, splitPath) && path.length > splitPath.length) {
    const childIndex = path[splitPath.length];
    return childIndex >= position
      ? [...rightPath, childIndex - position, ...path.slice(splitPath.length + 1)]
      : [...path];
  }
  if (hasPrefix(path, parent) && path.length > depth && path[depth] > splitPath[depth]) {
    const next = [...path];
    next[depth] += 1;
    return next;
  }
  return [...path];
};

const mergeAdjustedPath = (
  path: Path,
  rightPath: Path,
  leftContentLength: number
): Path => {
  const parent = rightPath.slice(0, -1);
  const depth = rightPath.length - 1;
  const leftPath = [...parent, rightPath[depth] - 1];
  if (hasPrefix(path, rightPath)) {
    if (path.length === rightPath.length) return leftPath;
    return [
      ...leftPath,
      path[rightPath.length] + leftContentLength,
      ...path.slice(rightPath.length + 1),
    ];
  }
  if (hasPrefix(path, parent) && path.length > depth && path[depth] > rightPath[depth]) {
    const next = [...path];
    next[depth] -= 1;
    return next;
  }
  return [...path];
};

const mapTextSplitPoint = (
  point: SmartPoint,
  path: Path,
  start: number,
  end: number,
  originalLength: number
): SmartPoint => {
  const before = start > 0 ? 1 : 0;
  const selected = end > start ? 1 : 0;
  const pieces = before + selected + (end < originalLength ? 1 : 0);
  const index = path[path.length - 1];
  const parent = path.slice(0, -1);

  if (!samePath(point.path, path)) {
    if (
      hasPrefix(point.path, parent) &&
      point.path.length > parent.length &&
      point.path[parent.length] > index
    ) {
      const mapped = [...point.path];
      mapped[parent.length] += pieces - 1;
      return { ...point, path: mapped };
    }
    return { ...point, path: [...point.path] };
  }

  if (point.offset <= start) {
    return { path: [...parent, index], offset: point.offset };
  }
  if (point.offset <= end && selected) {
    return { path: [...parent, index + before], offset: point.offset - start };
  }
  return {
    path: [...parent, index + before + selected],
    offset: Math.max(0, point.offset - end),
  };
};

const mapPoint = (
  point: SmartPoint,
  operation: SmartOperation,
  documentBefore: SmartDocument
): SmartPoint | null => {
  if (operation.type === "insertNode") {
    return { ...point, path: insertionAdjustedPath(point.path, operation.path) };
  }
  if (operation.type === "removeNode") {
    const path = removalAdjustedPath(point.path, operation.path);
    return path ? { ...point, path } : null;
  }
  if (operation.type === "moveNode") {
    const path = moveAdjustedPath(point.path, operation.from, operation.to);
    return path ? { ...point, path } : null;
  }
  if (operation.type === "splitNode") {
    const node = getNodeAtTreePath(documentBefore, operation.path);
    if (samePath(point.path, operation.path) && (node as { type?: unknown })?.type === "text") {
      if (point.offset <= operation.position) return { ...point, path: [...point.path] };
      const rightPath = [
        ...operation.path.slice(0, -1),
        operation.path[operation.path.length - 1] + 1,
      ];
      return { path: rightPath, offset: point.offset - operation.position };
    }
    return { ...point, path: splitAdjustedPath(point.path, operation.path, operation.position) };
  }
  if (operation.type === "mergeNode") {
    const right = getNodeAtTreePath(documentBefore, operation.path);
    const leftPath = [
      ...operation.path.slice(0, -1),
      operation.path[operation.path.length - 1] - 1,
    ];
    const left = getNodeAtTreePath(documentBefore, leftPath);
    const leftLength = (left as { type?: unknown })?.type === "text"
      ? (left as SmartTextNode).text.length
      : isSmartContainer(left)
        ? left.children.length
        : 0;
    if (samePath(point.path, operation.path) && (right as { type?: unknown })?.type === "text") {
      return { path: leftPath, offset: leftLength + point.offset };
    }
    return { ...point, path: mergeAdjustedPath(point.path, operation.path, leftLength) };
  }
  if (operation.type === "replaceText" && samePath(point.path, operation.path)) {
    const replacedLength = operation.end - operation.start;
    const delta = operation.text.length - replacedLength;
    if (point.offset <= operation.start) return { ...point, path: [...point.path] };
    if (point.offset <= operation.end) {
      return { ...point, path: [...point.path], offset: operation.start + operation.text.length };
    }
    return { ...point, path: [...point.path], offset: point.offset + delta };
  }
  if (
    (operation.type === "addMark" || operation.type === "removeMark")
  ) {
    const node = getNodeAtTreePath(documentBefore, operation.path) as SmartTextNode;
    return mapTextSplitPoint(point, operation.path, operation.start, operation.end, node.text.length);
  }
  return { ...point, path: [...point.path] };
};

const fallbackForRemovedPath = (path: Path): SmartSelection => ({
  type: "node",
  path: path.length ? path.slice(0, -1) : [],
});

export const mapSelectionThroughOperation = (
  selection: SmartSelection,
  operation: SmartOperation,
  documentBefore: SmartDocument
): SmartSelection => {
  if (operation.type === "setSelection") return operation.selection;
  if (selection.type === "all") return selection;
  if (selection.type === "node") {
    let path: Path | null = selection.path;
    if (operation.type === "insertNode") path = insertionAdjustedPath(path, operation.path);
    else if (operation.type === "removeNode") path = removalAdjustedPath(path, operation.path);
    else if (operation.type === "moveNode") path = moveAdjustedPath(path, operation.from, operation.to);
    else if (operation.type === "splitNode") path = splitAdjustedPath(path, operation.path, operation.position);
    else if (operation.type === "mergeNode") {
      const leftPath = [...operation.path.slice(0, -1), operation.path[operation.path.length - 1] - 1];
      const left = getNodeAtTreePath(documentBefore, leftPath);
      const length = isSmartContainer(left) ? left.children.length : 0;
      path = mergeAdjustedPath(path, operation.path, length);
    }
    return path
      ? { type: "node", path }
      : fallbackForRemovedPath(operation.type === "removeNode" ? operation.path : selection.path);
  }
  if (selection.type === "cell") {
    let tablePath: Path | null = selection.tablePath;
    if (operation.type === "insertNode") tablePath = insertionAdjustedPath(tablePath, operation.path);
    else if (operation.type === "removeNode") tablePath = removalAdjustedPath(tablePath, operation.path);
    else if (operation.type === "moveNode") tablePath = moveAdjustedPath(tablePath, operation.from, operation.to);
    else if (operation.type === "splitNode") tablePath = splitAdjustedPath(tablePath, operation.path, operation.position);
    else if (operation.type === "mergeNode") {
      const leftPath = [...operation.path.slice(0, -1), operation.path[operation.path.length - 1] - 1];
      const left = getNodeAtTreePath(documentBefore, leftPath);
      tablePath = mergeAdjustedPath(tablePath, operation.path, isSmartContainer(left) ? left.children.length : 0);
    }
    return tablePath
      ? { ...selection, tablePath }
      : fallbackForRemovedPath(operation.type === "removeNode" ? operation.path : selection.tablePath);
  }

  const anchor = mapPoint(selection.anchor, operation, documentBefore);
  const focus = mapPoint(selection.focus, operation, documentBefore);
  if (!anchor || !focus) {
    const removedPath = operation.type === "removeNode"
      ? operation.path
      : operation.type === "moveNode"
        ? operation.from
        : selection.anchor.path;
    return fallbackForRemovedPath(removedPath);
  }
  return { type: "text", anchor, focus };
};
