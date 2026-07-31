import type { CommandContext, SmartCommand } from "../command.js";
import {
  getNodeAtPath,
  type Path,
  type SmartFormulaNode,
  type SmartInlineImageNode,
  type SmartInlineNode,
} from "../model.js";
import { isSmartContainer } from "../tree.js";

export type SmartInlineAtom = SmartFormulaNode | SmartInlineImageNode;

export interface InlineAtomPathInput {
  path: Path;
}

const resolveAtom = (
  context: CommandContext,
  input: InlineAtomPathInput | undefined,
  expectedType: SmartInlineAtom["type"],
) => {
  if (!input?.path.length) return null;
  const atom = getNodeAtPath(context.document, input.path) as SmartInlineAtom | undefined;
  const parentPath = input.path.slice(0, -1);
  const parent = getNodeAtPath(context.document, parentPath);
  const index = input.path[input.path.length - 1];
  if (
    atom?.type !== expectedType ||
    !isSmartContainer(parent) ||
    !["paragraph", "heading"].includes(String((parent as { type?: unknown }).type)) ||
    parent.children[index] !== atom
  ) return null;
  return { parent, parentPath, index };
};

export const createDeleteInlineAtomCommand = (
  id: string,
  expectedType: SmartInlineAtom["type"],
): SmartCommand<InlineAtomPathInput> => ({
  id,
  isEnabled: (context, input) => Boolean(resolveAtom(context, input, expectedType)),
  execute: (context, input) => {
    const target = resolveAtom(context, input, expectedType);
    if (!target) throw new Error(`${id} requires a valid ${expectedType} path.`);
    const children = target.parent.children.filter((_, index) => index !== target.index) as SmartInlineNode[];
    let caretIndex = target.index;
    if (!children.length) {
      children.push({ type: "text", text: "" });
      caretIndex = 0;
    } else if (children[caretIndex]?.type !== "text") {
      if (caretIndex > 0 && children[caretIndex - 1]?.type === "text") {
        caretIndex -= 1;
      } else {
        children.splice(caretIndex, 0, { type: "text", text: "" });
      }
    }
    const caret = children[caretIndex];
    const offset = caret?.type === "text" && caretIndex < target.index ? caret.text.length : 0;
    return {
      id,
      source: "user",
      operations: [{
        type: "replaceNode",
        path: target.parentPath,
        node: { ...(target.parent as object), children },
      }],
      selectionBefore: context.selection,
      selectionAfter: {
        type: "text",
        anchor: { path: [...target.parentPath, caretIndex], offset },
        focus: { path: [...target.parentPath, caretIndex], offset },
      },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
});
