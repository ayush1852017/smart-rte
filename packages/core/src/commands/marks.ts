import type { CommandContext, SmartCommand } from "../command.js";
import { addMark, hasMark, removeMark, type InlineMarkType } from "../marks.js";
import { getNodeAtPath, type Path, type SmartMark, type SmartTextNode } from "../model.js";
import { sanitizeLinkAttrs } from "../security/urlPolicy.js";
import type { SmartTextSelection } from "../selection.js";
import type { SmartTransaction } from "../transaction.js";

const samePath = (left: Path, right: Path) => left.length === right.length && left.every((part, index) => part === right[index]);

type TextRange = {
  selection: SmartTextSelection;
  parentPath: Path;
  startIndex: number;
  endIndex: number;
  startOffset: number;
  endOffset: number;
  nodes: SmartTextNode[];
};

const getTextRange = (context: CommandContext): TextRange | null => {
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
  const parent = getNodeAtPath(context.document, parentPath) as { children?: SmartTextNode[] } | undefined;
  const nodes = parent?.children;
  if (!nodes || startIndex < 0 || endIndex >= nodes.length || startOffset < 0 || endOffset < 0) return null;
  if (nodes.slice(startIndex, endIndex + 1).some((node) => node.type !== "text")) return null;
  if (startIndex === endIndex && (startOffset === endOffset || endOffset > nodes[startIndex].text.length)) return null;
  if (startOffset > nodes[startIndex].text.length || endOffset > nodes[endIndex].text.length) return null;
  return { selection: context.selection, parentPath, startIndex, endIndex, startOffset, endOffset, nodes };
};

const replaceRange = (range: TextRange, mutate: (marks: SmartMark[] | undefined) => SmartMark[] | undefined): { children: SmartTextNode[]; start: number; end: number } => {
  const children: SmartTextNode[] = [];
  let selectionStart = 0;
  let selectionEnd = 0;
  range.nodes.forEach((node, index) => {
    if (index < range.startIndex || index > range.endIndex) {
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

const hasLink = (marks: readonly SmartMark[] | undefined) =>
  marks?.some((mark) => mark.type === "link") || false;

const createMarkTransaction = <Input>(
  id: string,
  context: CommandContext,
  input: Input,
  mutate: (marks: SmartMark[] | undefined, range: TextRange) => SmartMark[] | undefined,
): SmartTransaction => {
  const range = getTextRange(context);
  if (!range) throw new Error(`${id} requires text in one inline container.`);
  const result = replaceRange(range, (marks) => mutate(marks, range));
  const parent = getNodeAtPath(context.document, range.parentPath) as { children: SmartTextNode[] };
  const selectionAfter: SmartTextSelection = {
    type: "text",
    anchor: { path: [...range.parentPath, result.start], offset: 0 },
    focus: { path: [...range.parentPath, result.end], offset: result.children[result.end]?.text.length || 0 },
  };
  return {
    id,
    source: "user",
    operations: [{ type: "replaceNode", path: range.parentPath, node: { ...parent, children: result.children } }],
    selectionBefore: range.selection,
    selectionAfter,
    addToHistory: true,
    timestamp: context.now?.() ?? Date.now(),
  } as SmartTransaction;
};

const createMarkCommand = <Input>(id: string, nextMark: (input: Input) => SmartMark, toggle: boolean): SmartCommand<Input> => ({
  id,
  isEnabled: (context) => Boolean(getTextRange(context)),
  execute: (context, input) => {
    const range = getTextRange(context);
    if (!range) throw new Error(`${id} requires text in one inline container.`);
    const mark = nextMark(input as Input);
    const selected = range.nodes.slice(range.startIndex, range.endIndex + 1);
    const remove = toggle && selected.every((node) => hasMark(node.marks, mark.type as InlineMarkType));
    return createMarkTransaction(id, context, input, (marks) =>
      remove ? removeMark(marks, mark.type as InlineMarkType) : addMark(marks, mark));
  },
});

const toggle = (id: string, type: InlineMarkType) => createMarkCommand<void>(id, () => ({ type } as SmartMark), true);
export const toggleBold = toggle("toggle-bold", "bold");
export const toggleItalic = toggle("toggle-italic", "italic");
export const toggleUnderline = toggle("toggle-underline", "underline");
export const toggleSuperscript = toggle("toggle-superscript", "superscript");
export const toggleSubscript = toggle("toggle-subscript", "subscript");
export const applyTextColor = createMarkCommand<string>("apply-text-color", (value) => ({ type: "textColor", value }), false);
export const applyBackgroundColor = createMarkCommand<string>("apply-background-color", (value) => ({ type: "backgroundColor", value }), false);

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
    return Boolean(range && input && sanitizeLinkAttrs(input) && range.nodes.slice(range.startIndex, range.endIndex + 1).some((node) => hasLink(node.marks)));
  },
  execute: (context, input) => {
    const range = getTextRange(context);
    const safe = sanitizeLinkAttrs(input || {});
    if (!range || !safe || !range.nodes.slice(range.startIndex, range.endIndex + 1).some((node) => hasLink(node.marks))) {
      throw new Error("update-link requires selected linked text and a safe href.");
    }
    return createMarkTransaction("update-link", context, input, (marks) => addMark(marks, { type: "link", ...safe }));
  },
};

export const removeLink: SmartCommand<void> = {
  id: "remove-link",
  isEnabled: (context) => {
    const range = getTextRange(context);
    return Boolean(range && range.nodes.slice(range.startIndex, range.endIndex + 1).some((node) => hasLink(node.marks)));
  },
  execute: (context) => {
    if (!removeLink.isEnabled(context)) throw new Error("remove-link requires selected linked text.");
    return createMarkTransaction("remove-link", context, undefined, (marks) => removeMark(marks, "link"));
  },
};
