import { isTextNode } from "./identity.js";
import type {
  NormalizerRegistration,
  SmartDocument,
  SmartElementNode,
  SmartNode,
  SmartOperation,
  SmartSchema,
} from "./types.js";
import { nodeAtPath } from "./positions.js";

/**
 * Structural blocks such as quotes, tables, and atoms do not expose a native
 * caret at their outside edge.  Keep an ordinary editable block beside them
 * so the start/end of every block container remains addressable.  This is a
 * model invariant, not a renderer workaround: DOM whitespace is not a
 * position in the canonical document.
 */
const isBoundaryBlock = (node: SmartNode, schema: SmartSchema): node is SmartElementNode => {
  if (isTextNode(node)) return false;
  const spec = schema.nodes[node.type];
  return spec?.group === "block" && (
    node.type === "blockquote" ||
    node.type === "table" ||
    spec.atomic === true ||
    spec.isolating === true
  );
};

const acceptsBlockContent = (node: SmartElementNode, schema: SmartSchema): boolean => {
  if (node.type === "doc") return true;
  const expression = schema.nodes[node.type]?.content || "";
  return /(?:^|[|(\s])block(?:[+*?]|$)/.test(expression);
};

const isEditableBlock = (node: SmartNode, schema: SmartSchema): boolean => {
  if (isTextNode(node) || schema.nodes[node.type]?.group !== "block") return false;
  if (["paragraph", "heading", "code_block"].includes(node.type)) return true;
  return /(?:^|[|(\s])inline(?:[+*?]|$)/.test(schema.nodes[node.type]?.content || "");
};

const collectIds = (node: SmartNode, ids: Set<string>): void => {
  if (isTextNode(node)) return;
  ids.add(node.id);
  node.children?.forEach((child) => collectIds(child, ids));
};

const uniqueBoundaryId = (base: string, ids: Set<string>): string => {
  let candidate = base;
  let suffix = 2;
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
  ids.add(candidate);
  return candidate;
};

interface BoundaryInsertion {
  readonly path: number[];
  readonly offset: number;
  readonly id: string;
}

const comparePathsDescending = (left: readonly number[], right: readonly number[]): number => {
  if (left.length !== right.length) return right.length - left.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
};

/**
 * Returns deterministic insert operations for missing outside-edge caret
 * blocks.  The traversal is scoped by the supplied root path, allowing the
 * normalizer to remain local for ordinary typing.
 */
export const editableBoundaryOperations = (
  document: SmartDocument,
  schema: SmartSchema,
  rootPath: readonly number[] = [],
): SmartOperation[] => {
  const root = nodeAtPath(document, rootPath);
  if (!root || isTextNode(root)) return [];

  const ids = new Set<string>();
  let idsCollected = false;
  collectIds(document, ids);
  const insertions: BoundaryInsertion[] = [];
  const seen = new Set<string>();

  const add = (path: readonly number[], offset: number, base: string) => {
    const key = `${path.join(".")}:${offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Ordinary text/mark transactions normally need no boundary repair. Do
    // not pay a document-wide ID scan unless this traversal has actually
    // found a missing boundary paragraph to insert.
    if (!idsCollected) {
      collectIds(document, ids);
      idsCollected = true;
    }
    insertions.push({ path: [...path], offset, id: uniqueBoundaryId(base, ids) });
  };

  const visit = (node: SmartNode, path: readonly number[]) => {
    if (isTextNode(node)) return;
    const children = node.children || [];
    if (acceptsBlockContent(node, schema)) {
      children.forEach((child, index) => {
        if (!isBoundaryBlock(child, schema)) return;
        const previous = children[index - 1];
        const next = children[index + 1];
        if (index === 0 || !isEditableBlock(previous, schema)) {
          add(path, index, `smart-boundary-${node.id}-before-${child.id}`);
        }
        if (index === children.length - 1 || !isEditableBlock(next, schema)) {
          add(path, index + 1, `smart-boundary-${node.id}-after-${child.id}`);
        }
      });
    }
    children.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(root, rootPath);

  insertions.sort((left, right) => comparePathsDescending(left.path, right.path) || right.offset - left.offset);
  return insertions.map(({ path, offset, id }) => ({
    type: "insertNode" as const,
    pos: { path, offset },
    node: { type: "paragraph", id, children: [] },
  }));
};

export interface EditableBoundaryNormalizerOptions {
  readonly priority?: number;
}

export const createEditableBoundaryNormalizer = (
  options: EditableBoundaryNormalizerOptions = {},
): NormalizerRegistration => ({
  id: "foundation.editable-boundaries",
  priority: options.priority ?? 20,
  normalize: (document, context) => ({
    operations: editableBoundaryOperations(document, context.schema, context.affectedPath),
  }),
});
