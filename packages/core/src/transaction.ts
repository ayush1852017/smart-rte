import type { SmartDocument, Path, SmartMark, SmartTextNode } from "./model.js";
import type { SmartSelection } from "./selection.js";
import { addMark, removeMark, type InlineMarkType } from "./marks.js";
import { replaceNodeAtPath } from "./tree.js";

export type SmartOperation =
  | { type: "insertNode"; path: Path; node: unknown }
  | { type: "removeNode"; path: Path }
  | { type: "replaceNode"; path: Path; node: unknown }
  | { type: "setNodeAttrs"; path: Path; attrs: Record<string, unknown> }
  | { type: "addMark"; path: Path; start: number; end: number; mark: SmartMark }
  | { type: "removeMark"; path: Path; start: number; end: number; markType: InlineMarkType }
  | { type: "setSelection"; selection: SmartSelection };

export interface SmartTransaction {
  id: string;
  source: "user" | "paste" | "api" | "history" | "normalizer";
  operations: SmartOperation[];
  selectionBefore: SmartSelection;
  selectionAfter: SmartSelection;
  addToHistory: boolean;
  timestamp: number;
}

export interface SmartEditorState {
  document: SmartDocument;
  selection: SmartSelection;
}

const splitTextNode = (
  node: SmartTextNode,
  start: number,
  end: number,
  mutateMarks: (marks: SmartMark[] | undefined) => SmartMark[] | undefined
): SmartTextNode[] => {
  if (start < 0 || end < start || end > node.text.length) {
    throw new Error("Mark operation range is out of bounds.");
  }
  const result: SmartTextNode[] = [];
  if (start > 0) result.push({ ...node, text: node.text.slice(0, start) });
  const selectedText = node.text.slice(start, end);
  if (selectedText) result.push({ type: "text", text: selectedText, marks: mutateMarks(node.marks) });
  if (end < node.text.length) result.push({ ...node, text: node.text.slice(end) });
  return result;
};

const replaceTextAtPath = (
  document: SmartDocument,
  path: Path,
  replacement: SmartTextNode[]
): SmartDocument => {
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
  const target = children[textIndex] as SmartTextNode | undefined;
  if (!target || target.type !== "text") throw new Error("Mark operation path does not resolve to text.");
  const nextParent = {
    ...(parent as object),
    children: [...children.slice(0, textIndex), ...replacement, ...children.slice(textIndex + 1)],
  };
  return replaceNodeAtPath(document, parentPath, nextParent);
};

export const applyTransaction = (state: SmartEditorState, transaction: SmartTransaction): SmartEditorState => {
  let document = state.document;
  let selection = state.selection;

  transaction.operations.forEach((operation) => {
    if (operation.type === "replaceNode") {
      document = replaceNodeAtPath(document, operation.path, operation.node);
    } else if (operation.type === "addMark") {
      const node = operation.path.reduce<unknown>((value, index) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { children?: unknown[] }).children)) return undefined;
        return (value as { children: unknown[] }).children[index];
      }, document) as SmartTextNode | undefined;
      if (!node || node.type !== "text") throw new Error("Mark operation path does not resolve to text.");
      document = replaceTextAtPath(document, operation.path, splitTextNode(node, operation.start, operation.end, (marks) => addMark(marks, operation.mark)));
    } else if (operation.type === "removeMark") {
      const node = operation.path.reduce<unknown>((value, index) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { children?: unknown[] }).children)) return undefined;
        return (value as { children: unknown[] }).children[index];
      }, document) as SmartTextNode | undefined;
      if (!node || node.type !== "text") throw new Error("Mark operation path does not resolve to text.");
      document = replaceTextAtPath(document, operation.path, splitTextNode(node, operation.start, operation.end, (marks) => removeMark(marks, operation.markType)));
    } else if (operation.type === "setSelection") {
      selection = operation.selection;
    }
  });

  return { document, selection: transaction.selectionAfter || selection };
};
