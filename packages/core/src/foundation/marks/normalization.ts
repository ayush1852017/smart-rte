import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import { canonicalMarkOrder, stableValue } from "./canonical.js";
import type { NormalizerRegistration, SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartSchema } from "../types.js";

const normalizedInlineChildren = (children: readonly SmartNode[]): SmartNode[] => {
  const output: SmartNode[] = [];
  children.forEach((child) => {
    if (isTextNode(child) && !child.text) return;
    const normalized = isTextNode(child) && child.marks?.length
      ? { ...child, marks: canonicalMarkOrder(child.marks) }
      : child;
    const previous = output[output.length - 1];
    if (isTextNode(normalized) && previous && isTextNode(previous)
      && stableValue(previous.marks || []) === stableValue(normalized.marks || [])) {
      output[output.length - 1] = { ...previous, text: previous.text + normalized.text };
    } else output.push(normalized);
  });
  return output;
};

const inlineOwner = (node: SmartElementNode, schema: SmartSchema) =>
  schema.nodes[node.type]?.content?.includes("inline") === true;

export const createMarkNormalizer = (): NormalizerRegistration => ({
  id: "foundation.mark-normalization",
  priority: 100,
  normalize(document, context) {
    const root = nodeAtPath(document, context.affectedPath);
    if (!root || isTextNode(root)) return { operations: [] };
    const operations: SmartOperation[] = [];
    const visit = (node: SmartElementNode, path: number[]) => {
      if (inlineOwner(node, context.schema)) {
        const children = normalizedInlineChildren(node.children || []);
        if (stableValue(children) !== stableValue(node.children || [])) operations.push({
          type: "replaceNode",
          pos: { path: path.slice(0, -1), offset: path[path.length - 1] },
          before: node,
          after: { ...node, children },
        });
        return;
      }
      node.children?.forEach((child, index) => { if (!isTextNode(child)) visit(child, [...path, index]); });
    };
    visit(root, [...context.affectedPath]);
    return { operations };
  },
});
