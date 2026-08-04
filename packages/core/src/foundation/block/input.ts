import { createNodeId, isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos } from "../types.js";
import type { BlockCommandContext } from "./types.js";

export interface CodeBlockInputResult {
  readonly operations: SmartOperation[];
  readonly selectionTarget: { readonly ownerId: string; readonly offset: number };
  readonly intent: "newline" | "indent" | "exit-before" | "exit-after" | "fragment";
}

const codeAt = (document: SmartDocument, pos: SmartPos): SmartElementNode | null => {
  const node = nodeAtPath(document, pos.path);
  return node && !isTextNode(node) && node.type === "code_block" ? node : null;
};

const textOf = (node: SmartNode): string => {
  if (isTextNode(node)) return node.text;
  if (node.type === "hard_break") return "\n";
  return (node.children || []).map(textOf).join(node.type === "doc" || node.type === "blockquote" ? "\n" : "");
};

export const insertCodeBlockNewline = (
  document: SmartDocument,
  pos: SmartPos,
  options: { readonly exitOnTrailingEmptyLine?: boolean; readonly paragraphId?: string } = {},
): CodeBlockInputResult | null => {
  const code = codeAt(document, pos);
  if (!code) return null;
  const text = textOf(code);
  if (options.exitOnTrailingEmptyLine && pos.offset === text.length && text.endsWith("\n")) {
    return exitCodeBlock(document, pos, options.paragraphId || createNodeId());
  }
  return {
    operations: [{ type: "insertText", pos, text: "\n" }],
    selectionTarget: { ownerId: code.id, offset: pos.offset + 1 },
    intent: "newline",
  };
};

export const indentInsideCodeBlock = (document: SmartDocument, pos: SmartPos): CodeBlockInputResult | null => {
  const code = codeAt(document, pos);
  if (!code) return null;
  return {
    operations: [{ type: "insertText", pos, text: "\t" }],
    selectionTarget: { ownerId: code.id, offset: pos.offset + 1 },
    intent: "indent",
  };
};

/** Ctrl/Cmd+Enter exits before only at offset zero; otherwise it exits after. */
export const exitCodeBlock = (
  document: SmartDocument,
  pos: SmartPos,
  paragraphId = createNodeId(),
): CodeBlockInputResult | null => {
  const code = codeAt(document, pos);
  if (!code || !pos.path.length) return null;
  const parentPath = pos.path.slice(0, -1);
  const codeIndex = pos.path[pos.path.length - 1];
  const before = pos.offset === 0;
  return {
    operations: [{
      type: "insertNode",
      pos: { path: parentPath, offset: codeIndex + (before ? 0 : 1) },
      node: { type: "paragraph", id: paragraphId, children: [] },
    }],
    selectionTarget: { ownerId: paragraphId, offset: 0 },
    intent: before ? "exit-before" : "exit-after",
  };
};

/** Canonical fragment insertion only; Phase 8 owns clipboard parsing. */
export const insertPlainCodeFragment = (
  document: SmartDocument,
  pos: SmartPos,
  fragment: SmartDocument,
  _ctx: BlockCommandContext,
): CodeBlockInputResult | null => {
  const code = codeAt(document, pos);
  if (!code) return null;
  const text = fragment.children.map(textOf).join("\n");
  return {
    operations: text ? [{ type: "insertText", pos, text }] : [],
    selectionTarget: { ownerId: code.id, offset: pos.offset + text.length },
    intent: "fragment",
  };
};
