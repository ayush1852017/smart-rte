import type { LegacyCommandContext, SmartCommand } from "../command.js";
import { addMark, hasMark, removeMark, type InlineMarkType } from "../marks.js";
import {
  getNodeAtPath,
  type Path,
  type SmartInlineNode,
  type LegacySmartMark,
  type LegacySmartTextNode,
} from "../model.js";
import { sanitizeLinkAttrs } from "../security/urlPolicy.js";
import type { SmartTextSelection } from "../selection.js";
import type { LegacySmartTransaction } from "../transaction.js";

const samePath = (left: Path, right: Path) => left.length === right.length && left.every((part, index) => part === right[index]);

type TextRange = {
  selection: SmartTextSelection;
  parentPath: Path;
  startIndex: number;
  endIndex: number;
  startOffset: number;
  endOffset: number;
  nodes: SmartInlineNode[];
};

const getTextRange = (context: LegacyCommandContext): TextRange | null => {
  if (context.selection.type !== "text") return null;
  const { anchor, focus } = context.selection;
  const parentPath = anchor.path.slice(0, -1);
  if (!samePath(parentPath, focus.path.slice(0, -1))) return null;
  const anchorIndex = anchor.path[anchor.path.length - 1];
  const focusIndex = focus.path[focus.path.length - 1];
  const forward = anchorIndex < focusIndex || (anchorIndex === focusIndex && anchor.offset <= focus.offset);
  const startIndex = forward ? anchorIndex : focusIndex;
  const endIndex = forward ? focusIndex : anchorIndex;
  const startOffset = forward ? anchor.offset : focus.offset;
  const endOffset = forward ? focus.offset : anchor.offset;
  const parent = getNodeAtPath(context.document, parentPath) as { children?: SmartInlineNode[] } | undefined;
  const nodes = parent?.children;
  if (!nodes || startIndex < 0 || endIndex >= nodes.length || startOffset < 0 || endOffset < 0) return null;
  const startNode = nodes[startIndex];
  const endNode = nodes[endIndex];
  if (startNode?.type !== "text" || endNode?.type !== "text") return null;
  if (startIndex === endIndex && (startOffset === endOffset || endOffset > startNode.text.length)) return null;
  if (startOffset > startNode.text.length || endOffset > endNode.text.length) return null;
  if (!nodes.slice(startIndex, endIndex + 1).some((node) => node.type === "text")) return null;
  return { selection: context.selection, parentPath, startIndex, endIndex, startOffset, endOffset, nodes };
};

const replaceRange = (range: TextRange, mutate: (marks: LegacySmartMark[] | undefined) => LegacySmartMark[] | undefined): { children: SmartInlineNode[]; start: number; end: number } => {
  const children: SmartInlineNode[] = [];
  let selectionStart = 0;
  let selectionEnd = 0;
  range.nodes.forEach((node, index) => {
    if (index < range.startIndex || index > range.endIndex) {
      children.push(node);
      return;
    }
    if (node.type !== "text") {
      children.push(node);
      return;
    }
    const from = index === range.startIndex ? range.startOffset : 0;
    const to = index === range.endIndex ? range.endOffset : node.text.length;
    if (from > 0) children.push({ ...node, text: node.text.slice(0, from) });
    if (index === range.startIndex) selectionStart = children.length;
    const selected = node.text.slice(from, to);
    if (selected) children.push({ type: "text", text: selected, marks: mutate(node.marks) });
    if (index === range.endIndex) selectionEnd = children.length - 1;
    if (to < node.text.length) children.push({ ...node, text: node.text.slice(to) });
  });
  return { children, start: selectionStart, end: selectionEnd };
};

const hasLink = (marks: readonly LegacySmartMark[] | undefined) =>
  marks?.some((mark) => mark.type === "link") || false;

const selectedTextNodes = (range: TextRange) =>
  range.nodes
    .slice(range.startIndex, range.endIndex + 1)
    .filter((node): node is LegacySmartTextNode => node.type === "text");

const createMarkTransaction = <Input>(
  id: string,
  context: LegacyCommandContext,
  input: Input,
  mutate: (marks: LegacySmartMark[] | undefined, range: TextRange) => LegacySmartMark[] | undefined,
): LegacySmartTransaction => {
  const range = getTextRange(context);
  if (!range) throw new Error(`${id} requires text in one inline container.`);
  const result = replaceRange(range, (marks) => mutate(marks, range));
  const parent = getNodeAtPath(context.document, range.parentPath) as { children: SmartInlineNode[] };
  const selectionEnd = result.children[result.end];
  const selectionAfter: SmartTextSelection = {
    type: "text",
    anchor: { path: [...range.parentPath, result.start], offset: 0 },
    focus: {
      path: [...range.parentPath, result.end],
      offset: selectionEnd?.type === "text" ? selectionEnd.text.length : 0,
    },
  };
  return {
    id,
    source: "user",
    operations: [{ type: "replaceNode", path: range.parentPath, node: { ...parent, children: result.children } }],
    selectionBefore: range.selection,
    selectionAfter,
    addToHistory: true,
    timestamp: context.now?.() ?? Date.now(),
  } as LegacySmartTransaction;
};

const createMarkCommand = <Input>(id: string, nextMark: (input: Input) => LegacySmartMark, toggle: boolean): SmartCommand<Input> => ({
  id,
  isEnabled: (context) => Boolean(getTextRange(context)),
  execute: (context, input) => {
    const range = getTextRange(context);
    if (!range) throw new Error(`${id} requires text in one inline container.`);
    const mark = nextMark(input as Input);
    const selected = selectedTextNodes(range);
    const remove = toggle && selected.every((node) => hasMark(node.marks, mark.type as InlineMarkType));
    return createMarkTransaction(id, context, input, (marks) =>
      remove ? removeMark(marks, mark.type as InlineMarkType) : addMark(marks, mark));
  },
});

const toggle = (id: string, type: InlineMarkType) => createMarkCommand<void>(id, () => ({ type } as LegacySmartMark), true);
const toggleScript = (id: string, type: "superscript" | "subscript"):
  SmartCommand<void> => ({
  id,
  isEnabled: (context) => Boolean(getTextRange(context)),
  execute: (context) => {
    const range = getTextRange(context);
    if (!range) throw new Error(`${id} requires text in one inline container.`);
    const remove = selectedTextNodes(range)
      .every((node) => hasMark(node.marks, type));
    const opposite = type === "superscript" ? "subscript" : "superscript";
    return createMarkTransaction(id, context, undefined, (marks) => {
      const withoutOpposite = removeMark(marks, opposite);
      return remove ? removeMark(withoutOpposite, type) : addMark(withoutOpposite, { type });
    });
  },
});
export const toggleBold = toggle("toggle-bold", "bold");
export const toggleItalic = toggle("toggle-italic", "italic");
export const toggleUnderline = toggle("toggle-underline", "underline");
export const toggleStrike = toggle("toggle-strike", "strike");
export const toggleInlineCode = toggle("toggle-inline-code", "code");
export const toggleSuperscript = toggleScript("toggle-superscript", "superscript");
export const toggleSubscript = toggleScript("toggle-subscript", "subscript");
export const applyTextColor = createMarkCommand<string>("apply-text-color", (value) => ({ type: "textColor", value }), false);
export const applyBackgroundColor = createMarkCommand<string>("apply-background-color", (value) => ({ type: "backgroundColor", value }), false);
export const applyFontSize = createMarkCommand<number>("apply-font-size", (valuePx) => ({ type: "fontSize", valuePx }), false);
export const applyFontFamily = createMarkCommand<string>("apply-font-family", (value) => ({ type: "fontFamily", value }), false);

type LinkInput = { href: string; target?: string };

export const applyLink: SmartCommand<LinkInput> = {
  id: "apply-link",
  isEnabled: (context, input) => Boolean(getTextRange(context) && input && sanitizeLinkAttrs(input)),
  execute: (context, input) => {
    const safe = sanitizeLinkAttrs(input || {});
    if (!safe) throw new Error("apply-link requires a safe href.");
    return createMarkTransaction("apply-link", context, input, (marks) => addMark(marks, { type: "link", ...safe }));
  },
};

export const updateLink: SmartCommand<LinkInput> = {
  id: "update-link",
  isEnabled: (context, input) => {
    const range = getTextRange(context);
    return Boolean(range && input && sanitizeLinkAttrs(input) && selectedTextNodes(range).some((node) => hasLink(node.marks)));
  },
  execute: (context, input) => {
    const range = getTextRange(context);
    const safe = sanitizeLinkAttrs(input || {});
    if (!range || !safe || !selectedTextNodes(range).some((node) => hasLink(node.marks))) {
      throw new Error("update-link requires selected linked text and a safe href.");
    }
    return createMarkTransaction("update-link", context, input, (marks) => addMark(marks, { type: "link", ...safe }));
  },
};

export const removeLink: SmartCommand<void> = {
  id: "remove-link",
  isEnabled: (context) => {
    const range = getTextRange(context);
    return Boolean(range && selectedTextNodes(range).some((node) => hasLink(node.marks)));
  },
  execute: (context) => {
    if (!removeLink.isEnabled(context)) throw new Error("remove-link requires selected linked text.");
    return createMarkTransaction("remove-link", context, undefined, (marks) => removeMark(marks, "link"));
  },
};
