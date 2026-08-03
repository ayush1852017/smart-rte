import type { LegacySmartDocument, Path, LegacySmartMark, LegacySmartTextNode } from "./model.js";
import type { LegacySmartSelection } from "./selection.js";
import { mapSelectionThroughOperation } from "./selectionMapping.js";
import { normalizeSmartDocument } from "./schema.js";
import { addMark, removeMark, type InlineMarkType } from "./marks.js";
import {
  getNodeAtTreePath,
  insertNodeAtPath,
  isSmartContainer,
  removeNodeAtPath,
  replaceNodeAtPath,
} from "./tree.js";

export type LegacySmartOperation =
  | { type: "insertNode"; path: Path; node: unknown }
  | { type: "removeNode"; path: Path }
  | { type: "replaceNode"; path: Path; node: unknown }
  | { type: "moveNode"; from: Path; to: Path }
  | { type: "splitNode"; path: Path; position: number }
  | { type: "mergeNode"; path: Path }
  | { type: "setNodeAttrs"; path: Path; attrs: Record<string, unknown> }
  | { type: "replaceText"; path: Path; start: number; end: number; text: string }
  | { type: "addMark"; path: Path; start: number; end: number; mark: LegacySmartMark }
  | { type: "removeMark"; path: Path; start: number; end: number; markType: InlineMarkType }
  | { type: "setSelection"; selection: LegacySmartSelection };

export interface LegacySmartTransaction {
  id: string;
  source: "user" | "paste" | "api" | "history" | "normalizer";
  operations: LegacySmartOperation[];
  selectionBefore: LegacySmartSelection;
  selectionAfter?: LegacySmartSelection;
  addToHistory: boolean;
  historyGroup?: string;
  timestamp: number;
}

export interface SmartEditorState {
  document: LegacySmartDocument;
  selection: LegacySmartSelection;
}

const splitTextNode = (
  node: LegacySmartTextNode,
  start: number,
  end: number,
  mutateMarks: (marks: LegacySmartMark[] | undefined) => LegacySmartMark[] | undefined
): LegacySmartTextNode[] => {
  if (start < 0 || end < start || end > node.text.length) {
    throw new Error("Mark operation range is out of bounds.");
  }
  const result: LegacySmartTextNode[] = [];
  if (start > 0) result.push({ ...node, text: node.text.slice(0, start) });
  const selectedText = node.text.slice(start, end);
  if (selectedText) result.push({ type: "text", text: selectedText, marks: mutateMarks(node.marks) });
  if (end < node.text.length) result.push({ ...node, text: node.text.slice(end) });
  return result;
};

const replaceTextAtPath = (
  document: LegacySmartDocument,
  path: Path,
  replacement: LegacySmartTextNode[]
): LegacySmartDocument => {
  if (path.length === 0) throw new Error("A text node path cannot be empty.");
  const parentPath = path.slice(0, -1);
  const textIndex = path[path.length - 1];
  const parent = parentPath.reduce<unknown>((node, index) => {
    if (!node || typeof node !== "object" || !Array.isArray((node as { children?: unknown[] }).children)) {
      return undefined;
    }
    return (node as { children: unknown[] }).children[index];
  }, document);
  if (!parent || typeof parent !== "object" || !Array.isArray((parent as { children?: unknown[] }).children)) {
    throw new Error("Mark operation parent is not a text container.");
  }
  const children = (parent as { children: unknown[] }).children;
  const target = children[textIndex] as LegacySmartTextNode | undefined;
  if (!target || target.type !== "text") throw new Error("Mark operation path does not resolve to text.");
  const nextParent = {
    ...(parent as object),
    children: [...children.slice(0, textIndex), ...replacement, ...children.slice(textIndex + 1)],
  };
  return replaceNodeAtPath(document, parentPath, nextParent);
};

const samePath = (left: Path, right: Path) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const isAncestorPath = (ancestor: Path, descendant: Path) =>
  ancestor.length < descendant.length && ancestor.every((part, index) => descendant[index] === part);

export const getMoveDestinationAfterRemoval = (from: Path, to: Path): Path => {
  const fromParent = from.slice(0, -1);
  const depth = fromParent.length;
  const sharesRemovedParent = fromParent.every((part, index) => to[index] === part);
  if (!sharesRemovedParent || to.length <= depth) return [...to];
  const destination = [...to];
  if (from[depth] < destination[depth]) destination[depth] -= 1;
  return destination;
};

const nodeAttributes = (node: Record<string, unknown>, contentKey: "children" | "text") => {
  const attributes = { ...node };
  delete attributes[contentKey];
  return attributes;
};

const sameAttributes = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  contentKey: "children" | "text"
) => JSON.stringify(nodeAttributes(left, contentKey)) === JSON.stringify(nodeAttributes(right, contentKey));

export const applyOperationToState = (
  document: LegacySmartDocument,
  selection: LegacySmartSelection,
  operation: LegacySmartOperation
): { document: LegacySmartDocument; selection: LegacySmartSelection } => {
  if (operation.type === "insertNode") {
    return { document: insertNodeAtPath(document, operation.path, operation.node), selection };
  }
  if (operation.type === "removeNode") {
    return { document: removeNodeAtPath(document, operation.path).document, selection };
  }
  if (operation.type === "replaceNode") {
    return { document: replaceNodeAtPath(document, operation.path, operation.node), selection };
  }
  if (operation.type === "moveNode") {
    if (operation.from.length === 0 || operation.to.length === 0) {
      throw new Error("Move paths cannot target the document root.");
    }
    if (samePath(operation.from, operation.to)) return { document, selection };
    if (isAncestorPath(operation.from, operation.to)) {
      throw new Error("A node cannot be moved into its own descendant.");
    }
    const removed = removeNodeAtPath(document, operation.from);
    const destination = getMoveDestinationAfterRemoval(operation.from, operation.to);
    return { document: insertNodeAtPath(removed.document, destination, removed.node), selection };
  }
  if (operation.type === "splitNode") {
    if (operation.path.length === 0) throw new Error("The document root cannot be split.");
    const node = getNodeAtTreePath(document, operation.path);
    if (!node || typeof node !== "object") throw new Error("Split path does not resolve to a node.");
    const position = operation.position;
    if (!Number.isInteger(position) || position < 0) throw new Error("Split position must be a non-negative integer.");
    let left: unknown;
    let right: unknown;
    if ((node as { type?: unknown }).type === "text") {
      const textNode = node as LegacySmartTextNode;
      if (position > textNode.text.length) throw new Error("Text split position is out of bounds.");
      left = { ...textNode, text: textNode.text.slice(0, position) };
      right = { ...textNode, text: textNode.text.slice(position) };
    } else if (isSmartContainer(node)) {
      if (position > node.children.length) throw new Error("Container split position is out of bounds.");
      left = { ...(node as object), children: node.children.slice(0, position) };
      right = { ...(node as object), children: node.children.slice(position) };
    } else {
      throw new Error("Only text nodes and container nodes can be split.");
    }
    const replaced = replaceNodeAtPath(document, operation.path, left);
    const rightPath = [...operation.path.slice(0, -1), operation.path[operation.path.length - 1] + 1];
    return { document: insertNodeAtPath(replaced, rightPath, right), selection };
  }
  if (operation.type === "mergeNode") {
    if (operation.path.length === 0) throw new Error("The document root cannot be merged.");
    const rightIndex = operation.path[operation.path.length - 1];
    if (rightIndex === 0) throw new Error("Merge node has no previous sibling.");
    const leftPath = [...operation.path.slice(0, -1), rightIndex - 1];
    const left = getNodeAtTreePath(document, leftPath);
    const right = getNodeAtTreePath(document, operation.path);
    if (!left || !right || typeof left !== "object" || typeof right !== "object") {
      throw new Error("Merge paths must resolve to nodes.");
    }
    let merged: unknown;
    if ((left as { type?: unknown }).type === "text" && (right as { type?: unknown }).type === "text") {
      const leftText = left as LegacySmartTextNode;
      const rightText = right as LegacySmartTextNode;
      if (!sameAttributes(left as unknown as Record<string, unknown>, right as unknown as Record<string, unknown>, "text")) {
        throw new Error("Text nodes with different marks cannot be merged.");
      }
      merged = { ...leftText, text: leftText.text + rightText.text };
    } else if (isSmartContainer(left) && isSmartContainer(right)) {
      if (!sameAttributes(left as unknown as Record<string, unknown>, right as unknown as Record<string, unknown>, "children")) {
        throw new Error("Container nodes with different attributes cannot be merged.");
      }
      merged = { ...(left as object), children: [...left.children, ...right.children] };
    } else {
      throw new Error("Merge nodes must have compatible structures.");
    }
    const replaced = replaceNodeAtPath(document, leftPath, merged);
    return { document: removeNodeAtPath(replaced, operation.path).document, selection };
  }
  if (operation.type === "setNodeAttrs") {
    const node = getNodeAtTreePath(document, operation.path);
    if (!node || typeof node !== "object") throw new Error("Attribute path does not resolve to a node.");
    if ("type" in operation.attrs || "children" in operation.attrs || "text" in operation.attrs) {
      throw new Error("setNodeAttrs cannot replace structural node fields.");
    }
    const replacement: Record<string, unknown> = { ...(node as Record<string, unknown>) };
    Object.entries(operation.attrs).forEach(([name, value]) => {
      if (value === undefined) delete replacement[name];
      else replacement[name] = value;
    });
    return { document: replaceNodeAtPath(document, operation.path, replacement), selection };
  }
  if (operation.type === "replaceText") {
    const node = getNodeAtTreePath(document, operation.path) as LegacySmartTextNode;
    if (!node || node.type !== "text") throw new Error("Text operation path does not resolve to text.");
    if (
      !Number.isInteger(operation.start) ||
      !Number.isInteger(operation.end) ||
      operation.start < 0 ||
      operation.end < operation.start ||
      operation.end > node.text.length
    ) {
      throw new Error("Text replacement range is out of bounds.");
    }
    return {
      document: replaceNodeAtPath(document, operation.path, {
        ...node,
        text: node.text.slice(0, operation.start) + operation.text + node.text.slice(operation.end),
      }),
      selection,
    };
  }
  if (operation.type === "addMark") {
    const node = getNodeAtTreePath(document, operation.path) as LegacySmartTextNode;
    if (!node || node.type !== "text") throw new Error("Mark operation path does not resolve to text.");
    return {
      document: replaceTextAtPath(
        document,
        operation.path,
        splitTextNode(node, operation.start, operation.end, (marks) => addMark(marks, operation.mark))
      ),
      selection,
    };
  }
  if (operation.type === "removeMark") {
    const node = getNodeAtTreePath(document, operation.path) as LegacySmartTextNode;
    if (!node || node.type !== "text") throw new Error("Mark operation path does not resolve to text.");
    return {
      document: replaceTextAtPath(
        document,
        operation.path,
        splitTextNode(node, operation.start, operation.end, (marks) => removeMark(marks, operation.markType))
      ),
      selection,
    };
  }
  return { document, selection: operation.selection };
};

export const applyTransaction = (state: SmartEditorState, transaction: LegacySmartTransaction): SmartEditorState => {
  let document = state.document;
  let selection = state.selection;

  transaction.operations.forEach((operation) => {
    const documentBefore = document;
    const next = applyOperationToState(document, selection, operation);
    document = next.document;
    selection = operation.type === "setSelection"
      ? next.selection
      : mapSelectionThroughOperation(selection, operation, documentBefore);
  });

  return {
    document: normalizeSmartDocument(document),
    selection: transaction.selectionAfter ?? selection,
  };
};
