import type { SmartCommand } from "../command.js";
import { getNodeAtPath, type SmartInlineNode, type LegacySmartTextNode } from "../model.js";
import { isSmartContainer } from "../tree.js";
import { createDeleteInlineAtomCommand } from "./inlineAtoms.js";

export interface InsertFormulaInput {
  value: string;
  displayText?: string;
}

const resolveFormulaTarget = (
  context: Parameters<SmartCommand<InsertFormulaInput>["isEnabled"]>[0],
  input?: InsertFormulaInput,
) => {
  if (!input?.value.trim() || context.selection.type !== "text") return null;
  const { anchor, focus } = context.selection;
  if (
    anchor.offset !== focus.offset ||
    anchor.path.length !== focus.path.length ||
    !anchor.path.every((part, index) => focus.path[index] === part)
  ) return null;
  const node = getNodeAtPath(context.document, anchor.path) as LegacySmartTextNode | undefined;
  const parentPath = anchor.path.slice(0, -1);
  const parent = getNodeAtPath(context.document, parentPath);
  if (node?.type !== "text" || !isSmartContainer(parent) ||
      anchor.offset < 0 || anchor.offset > node.text.length) return null;
  return { node, parent, parentPath, index: anchor.path[anchor.path.length - 1], offset: anchor.offset };
};

export const insertFormula: SmartCommand<InsertFormulaInput> = {
  id: "formula.insert",
  isEnabled: (context, input) => Boolean(resolveFormulaTarget(context, input)),
  execute: (context, input) => {
    const target = resolveFormulaTarget(context, input);
    if (!target || !input) throw new Error("formula.insert requires a collapsed text selection and a formula.");
    const formulaText = input.displayText ?? input.value;
    const children = [...target.parent.children];
    const replacement: SmartInlineNode[] = [];
    if (target.offset > 0) {
      replacement.push({ ...target.node, text: target.node.text.slice(0, target.offset) });
    }
    replacement.push({
      type: "formula",
      value: input.value.trim(),
      ...(formulaText !== input.value ? { displayText: formulaText } : {}),
    });
    const formulaIndex = target.index + (target.offset > 0 ? 1 : 0);
    const trailingText = target.node.text.slice(target.offset);
    replacement.push({ ...target.node, text: trailingText });
    return {
      id: "formula.insert",
      source: "user",
      operations: [{
        type: "replaceNode",
        path: target.parentPath,
        node: {
          ...(target.parent as object),
          children: [
            ...children.slice(0, target.index),
            ...replacement,
            ...children.slice(target.index + 1),
          ],
        },
      }],
      selectionBefore: context.selection,
      selectionAfter: {
        type: "text",
        anchor: { path: [...target.parentPath, formulaIndex + 1], offset: 0 },
        focus: { path: [...target.parentPath, formulaIndex + 1], offset: 0 },
      },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export const deleteFormula = createDeleteInlineAtomCommand("formula.delete", "formula");
