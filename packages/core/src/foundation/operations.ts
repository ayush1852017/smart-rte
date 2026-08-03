import { assertUniqueNodeIds, cloneNode, isTextNode } from "./identity.js";
import { nodeAtPath, samePath } from "./positions.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartMark, SmartNode, SmartOperation, SmartPos, SmartRange } from "./types.js";
import { canonicalMarkOrder } from "./marks/canonical.js";

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const parentAndIndex = (document: SmartDocument, pos: SmartPos) => {
  const parent = nodeAtPath(document, pos.path);
  if (!parent || isTextNode(parent) || !parent.children) throw new Error("Operation position does not resolve to a container.");
  if (!Number.isInteger(pos.offset) || pos.offset < 0 || pos.offset > parent.children.length) throw new Error("Operation child offset is out of bounds.");
  return { parent, index: pos.offset };
};

/**
 * Transaction-local copy-on-write tree. A node is copied at most once in one
 * operation batch; unchanged siblings retain reference identity. This identity
 * guarantee is the memoization contract for scope indexing and DOM rendering.
 */
class PathCopySession {
  private root: SmartDocument;
  private readonly copies = new WeakMap<SmartElementNode, SmartElementNode>();
  private readonly mutable = new WeakSet<SmartElementNode>();

  constructor(readonly input: SmartDocument) { this.root = input; }

  document(): SmartDocument { return this.root; }

  node(path: readonly number[]): SmartNode | undefined { return nodeAtPath(this.root, path); }

  private copy(node: SmartElementNode): SmartElementNode {
    if (this.mutable.has(node)) return node;
    const existing = this.copies.get(node);
    if (existing) return existing;
    const draft: SmartElementNode = { ...node, ...(node.children ? { children: [...node.children] } : {}) };
    this.copies.set(node, draft);
    this.mutable.add(draft);
    return draft;
  }

  container(path: readonly number[]): SmartElementNode {
    let current = this.copy(this.root);
    this.root = current as SmartDocument;
    for (const index of path) {
      const children = current.children;
      const child = children?.[index];
      if (!child || isTextNode(child)) throw new Error("Container path does not resolve to an element.");
      const next = this.copy(child);
      (children as SmartNode[])[index] = next;
      current = next;
    }
    return current;
  }

  replace(path: readonly number[], replacement: SmartNode): void {
    if (!path.length) {
      if (isTextNode(replacement) || replacement.type !== "doc") throw new Error("Document root replacement must be a doc node.");
      this.root = replacement as SmartDocument;
      return;
    }
    const parent = this.container(path.slice(0, -1));
    const index = path[path.length - 1];
    if (!parent.children || index < 0 || index >= parent.children.length) throw new Error("Replacement index is out of bounds.");
    (parent.children as SmartNode[])[index] = replacement;
  }
}

const marksKey = (marks: readonly SmartMark[] | undefined) => JSON.stringify(canonicalMarkOrder(marks));
const normalizeInline = (children: readonly SmartNode[]): SmartNode[] => {
  const result: SmartNode[] = [];
  children.forEach((node) => {
    if (isTextNode(node) && !node.text) return;
    if (isTextNode(node) && node.marks?.length) node = { ...node, marks: canonicalMarkOrder(node.marks) };
    const previous = result[result.length - 1];
    if (isTextNode(node) && previous && isTextNode(previous) && marksKey(previous.marks) === marksKey(node.marks)) {
      result[result.length - 1] = { ...previous, text: previous.text + node.text };
    } else result.push(node);
  });
  return result;
};

const splitInlineAt = (children: readonly SmartNode[], offset: number): [SmartNode[], SmartNode[]] => {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Inline offset is invalid.");
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let consumed = 0;
  let split = false;
  children.forEach((node) => {
    if (split) return after.push(node);
    const size = isTextNode(node) ? node.text.length : 1;
    if (offset > consumed + size) {
      before.push(node);
      consumed += size;
      return;
    }
    const local = offset - consumed;
    if (isTextNode(node)) {
      if (local > 0) before.push({ ...node, text: node.text.slice(0, local) });
      if (local < size) after.push({ ...node, text: node.text.slice(local) });
    } else {
      if (local === 0) after.push(node);
      else if (local === 1) before.push(node);
      else throw new Error("Atomic inline offset is invalid.");
    }
    split = true;
    consumed += size;
  });
  if (!split && offset !== consumed) throw new Error("Inline offset is out of bounds.");
  return [before, after];
};

const inlineContainer = (document: SmartDocument, pos: SmartPos): SmartElementNode => {
  const node = nodeAtPath(document, pos.path);
  if (!node || isTextNode(node) || !node.children) {
    throw new Error("Text operation must target an inline container.");
  }
  return node;
};

const insertText = (session: PathCopySession, pos: SmartPos, text: string, marks?: SmartMark[]) => {
  const container = inlineContainer(session.document(), pos);
  const [before, after] = splitInlineAt(container.children || [], pos.offset);
  const inserted: SmartNode[] = text ? [{ type: "text", text, ...(marks?.length ? { marks: structuredClone(marks) } : {}) }] : [];
  const draft = session.container(pos.path);
  (draft as { children?: readonly SmartNode[] }).children = normalizeInline([...before, ...inserted, ...after]);
};

const deleteText = (session: PathCopySession, pos: SmartPos, text: string) => {
  const container = inlineContainer(session.document(), pos);
  const [before, tail] = splitInlineAt(container.children || [], pos.offset);
  const [removed, after] = splitInlineAt(tail, text.length);
  const actual = removed.map((node) => isTextNode(node) ? node.text : "\uFFFC").join("");
  if (actual !== text) throw new Error(`deleteText payload does not match document content.`);
  const draft = session.container(pos.path);
  (draft as { children?: readonly SmartNode[] }).children = normalizeInline([...before, ...after]);
};

const applyMark = (session: PathCopySession, range: SmartRange, mark: SmartMark, add: boolean): void => {
  const comparePath = (left: readonly number[], right: readonly number[]) => {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
    return left.length - right.length;
  };
  if (comparePath(range.from.path, range.to.path) > 0 || (samePath(range.from.path, range.to.path) && range.from.offset > range.to.offset)) {
    throw new Error("Mark operation range must be normalized from/to.");
  }
  const paths: number[][] = [];
  const visit = (node: SmartNode, path: number[]) => {
    if (isTextNode(node)) return;
    if (samePath(path, range.from.path) && samePath(path, range.to.path)) paths.push(path);
    else if ((node.type === "paragraph" || node.type === "heading") &&
      comparePath(path, range.from.path) >= 0 && comparePath(path, range.to.path) <= 0) paths.push(path);
    node.children?.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(session.document(), []);
  paths.forEach((path) => {
    const container = inlineContainer(session.document(), { path, offset: 0 });
    const size = (container.children || []).reduce((total, child) => total + (isTextNode(child) ? child.text.length : 1), 0);
    const start = samePath(path, range.from.path) ? range.from.offset : 0;
    const end = samePath(path, range.to.path) ? range.to.offset : size;
    const [before, tail] = splitInlineAt(container.children || [], start);
    const [middle, after] = splitInlineAt(tail, end - start);
    const changed = middle.map((node): SmartNode => {
      if (!isTextNode(node)) return node;
      const marks = node.marks || [];
      if (add) {
        if (marks.some((candidate) => sameValue(candidate, mark))) return node;
        return { ...node, marks: canonicalMarkOrder([...marks, structuredClone(mark)]) };
      }
      const next = marks.filter((candidate) => !sameValue(candidate, mark));
      return { ...node, ...(next.length ? { marks: next } : { marks: undefined }) };
    });
    const draft = session.container(path);
    (draft as { children?: readonly SmartNode[] }).children = normalizeInline([...before, ...changed, ...after]);
  });
};

const applyToSession = (session: PathCopySession, operation: SmartOperation): boolean => {
  const document = session.document();
  if (operation.type === "insertNode") {
    const { parent, index } = parentAndIndex(document, operation.pos);
    const draft = session.container(operation.pos.path);
    (draft as { children?: readonly SmartNode[] }).children = [...(parent.children || []).slice(0, index), cloneNode(operation.node), ...(parent.children || []).slice(index)];
  } else if (operation.type === "removeNode") {
    const { parent, index } = parentAndIndex(document, operation.pos);
    const existing = parent.children?.[index];
    if (!existing || !sameValue(existing, operation.node)) throw new Error("removeNode payload does not match document node.");
    const draft = session.container(operation.pos.path);
    (draft as { children?: readonly SmartNode[] }).children = [...(parent.children || []).slice(0, index), ...(parent.children || []).slice(index + 1)];
  } else if (operation.type === "replaceNode") {
    const { parent, index } = parentAndIndex(document, operation.pos);
    if (!sameValue(parent.children?.[index], operation.before)) throw new Error("replaceNode before payload does not match document node.");
    const draft = session.container(operation.pos.path);
    (draft as { children?: readonly SmartNode[] }).children = (parent.children || []).map((node, nodeIndex) => nodeIndex === index ? cloneNode(operation.after) : node);
  } else if (operation.type === "moveNode") {
    const source = parentAndIndex(document, operation.from);
    const moving = source.parent.children?.[source.index];
    if (!moving || isTextNode(moving) || moving.id !== operation.nodeId) throw new Error("moveNode source does not match nodeId.");
    const sourceDraft = session.container(operation.from.path);
    (sourceDraft as { children?: readonly SmartNode[] }).children = [...(source.parent.children || []).slice(0, source.index), ...(source.parent.children || []).slice(source.index + 1)];
    const destination = parentAndIndex(session.document(), operation.to);
    const destinationDraft = session.container(operation.to.path);
    (destinationDraft as { children?: readonly SmartNode[] }).children = [...(destination.parent.children || []).slice(0, destination.index), moving, ...(destination.parent.children || []).slice(destination.index)];
  } else if (operation.type === "splitNode") {
    const targetPath = operation.pos.path.slice(0, operation.pos.path.length - operation.depth);
    const target = session.node(targetPath);
    if (!target || isTextNode(target) || !target.children) throw new Error("splitNode target must be a container.");
    if (operation.pos.offset < 0 || operation.pos.offset > target.children.length) throw new Error("splitNode offset is out of bounds.");
    const left = { ...target, children: target.children.slice(0, operation.pos.offset) };
    const right = { ...target, id: operation.newId, children: target.children.slice(operation.pos.offset) };
    const parentPath = targetPath.slice(0, -1);
    const index = targetPath[targetPath.length - 1];
    const parent = session.node(parentPath);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("splitNode parent is invalid.");
    const draft = session.container(parentPath);
    (draft as { children?: readonly SmartNode[] }).children = [...parent.children.slice(0, index), left, right, ...parent.children.slice(index + 1)];
  } else if (operation.type === "mergeNode") {
    const parent = session.node(operation.pos.path);
    if (!parent || isTextNode(parent) || !parent.children) throw new Error("mergeNode parent is invalid.");
    const rightIndex = operation.pos.offset;
    const left = parent.children[rightIndex - 1];
    const right = parent.children[rightIndex];
    if (!left || !right || isTextNode(left) || isTextNode(right) || right.id !== operation.retiredId) throw new Error("mergeNode nodes are invalid.");
    const comparable = (node: SmartElementNode) => {
      const { id: _id, children: _children, ...rest } = node;
      return rest;
    };
    if (!sameValue(comparable(left), comparable(right)) || operation.splitOffset !== (left.children || []).length) {
      throw new Error("mergeNode requires structurally compatible siblings and the exact split offset.");
    }
    const merged = { ...left, children: [...(left.children || []), ...(right.children || [])] };
    const draft = session.container(operation.pos.path);
    (draft as { children?: readonly SmartNode[] }).children = [...parent.children.slice(0, rightIndex - 1), merged, ...parent.children.slice(rightIndex + 1)];
  } else if (operation.type === "setNodeAttributes") {
    const target = session.node(operation.pos.path);
    if (!target || isTextNode(target) || !sameValue(target.attrs || {}, operation.before)) throw new Error("setNodeAttributes before payload does not match.");
    const { attrs: _attrs, ...withoutAttrs } = target;
    session.replace(operation.pos.path, Object.keys(operation.after).length
      ? { ...withoutAttrs, attrs: structuredClone(operation.after) }
      : withoutAttrs as SmartElementNode);
  } else if (operation.type === "insertText") insertText(session, operation.pos, operation.text, operation.marks);
  else if (operation.type === "deleteText") deleteText(session, operation.pos, operation.text);
  else if (operation.type === "addMark") applyMark(session, operation.range, operation.mark, true);
  else applyMark(session, operation.range, operation.mark, false);
  return operation.type === "insertNode" || operation.type === "replaceNode" || operation.type === "splitNode";
};

export const applyOperation = (input: SmartDocument, operation: SmartOperation): SmartDocument => {
  const session = new PathCopySession(input);
  const identityChanged = applyToSession(session, operation);
  const document = session.document();
  if (identityChanged) assertUniqueNodeIds(document);
  return document;
};

export const invertOperation = (operation: SmartOperation): SmartOperation => {
  if (operation.type === "insertNode") return { type: "removeNode", pos: operation.pos, node: cloneNode(operation.node) };
  if (operation.type === "removeNode") return { type: "insertNode", pos: operation.pos, node: cloneNode(operation.node) };
  if (operation.type === "replaceNode") return { ...operation, before: cloneNode(operation.after), after: cloneNode(operation.before) };
  if (operation.type === "moveNode") return { ...operation, from: operation.to, to: operation.from };
  if (operation.type === "splitNode") {
    const targetPath = operation.pos.path.slice(0, operation.pos.path.length - operation.depth);
    return { type: "mergeNode", pos: { path: targetPath.slice(0, -1), offset: targetPath[targetPath.length - 1] + 1 }, depth: operation.depth, retiredId: operation.newId, splitOffset: operation.pos.offset };
  }
  if (operation.type === "mergeNode") {
    const leftPath = [...operation.pos.path, operation.pos.offset - 1];
    return { type: "splitNode", pos: { path: leftPath, offset: operation.splitOffset }, depth: operation.depth, newId: operation.retiredId };
  }
  if (operation.type === "setNodeAttributes") return { ...operation, before: structuredClone(operation.after), after: structuredClone(operation.before) };
  if (operation.type === "insertText") return { type: "deleteText", pos: operation.pos, text: operation.text, ...(operation.marks ? { marks: structuredClone(operation.marks) } : {}) };
  if (operation.type === "deleteText") return { type: "insertText", pos: operation.pos, text: operation.text, ...(operation.marks ? { marks: structuredClone(operation.marks) } : {}) };
  if (operation.type === "addMark") return { type: "removeMark", range: operation.range, mark: structuredClone(operation.mark) };
  return { type: "addMark", range: operation.range, mark: structuredClone(operation.mark) };
};

export const applyOperations = (document: SmartDocument, operations: readonly SmartOperation[]): SmartDocument => {
  const session = new PathCopySession(document);
  let identityChanged = false;
  operations.forEach((operation) => { identityChanged = applyToSession(session, operation) || identityChanged; });
  const result = session.document();
  if (identityChanged) assertUniqueNodeIds(result);
  return result;
};

export const invertOperations = (operations: readonly SmartOperation[]): SmartOperation[] =>
  [...operations].reverse().map(invertOperation);

const shiftPath = (pos: SmartPos, parent: SmartPos, delta: number): SmartPos => {
  if (!samePath(pos.path.slice(0, parent.path.length), parent.path) || pos.path.length <= parent.path.length) return pos;
  const path = [...pos.path];
  const index = path[parent.path.length];
  if (index >= parent.offset) path[parent.path.length] += delta;
  return { ...pos, path };
};

export const mapPosThroughOperation = (pos: SmartPos, operation: SmartOperation, bias: -1 | 1 = 1): { pos: SmartPos; deleted: boolean } => {
  if (operation.type === "insertNode") {
    if (samePath(pos.path, operation.pos.path) && pos.offset === operation.pos.offset) return { pos: { ...pos, offset: pos.offset + (bias > 0 ? 1 : 0) }, deleted: false };
    return { pos: shiftPath(pos, operation.pos, 1), deleted: false };
  }
  if (operation.type === "removeNode") {
    const removedPath = [...operation.pos.path, operation.pos.offset];
    if (samePath(pos.path.slice(0, removedPath.length), removedPath)) return { pos: { path: [...operation.pos.path], offset: operation.pos.offset }, deleted: true };
    if (samePath(pos.path, operation.pos.path) && pos.offset > operation.pos.offset) return { pos: { ...pos, offset: pos.offset - 1 }, deleted: false };
    return { pos: shiftPath(pos, operation.pos, -1), deleted: false };
  }
  if (operation.type === "replaceNode") {
    const replaced = [...operation.pos.path, operation.pos.offset];
    return samePath(pos.path.slice(0, replaced.length), replaced)
      ? { pos: { path: [...operation.pos.path], offset: operation.pos.offset + (bias > 0 ? 1 : 0) }, deleted: true }
      : { pos, deleted: false };
  }
  if (operation.type === "moveNode") {
    const sourcePath = [...operation.from.path, operation.from.offset];
    if (samePath(pos.path.slice(0, sourcePath.length), sourcePath)) {
      return { pos: { ...pos, path: [...operation.to.path, operation.to.offset, ...pos.path.slice(sourcePath.length)] }, deleted: false };
    }
    const removed = mapPosThroughOperation(pos, { type: "removeNode", pos: operation.from, node: { type: "unknown", id: operation.nodeId } }, bias);
    return mapPosThroughOperation(removed.pos, { type: "insertNode", pos: operation.to, node: { type: "unknown", id: operation.nodeId } }, bias);
  }
  if (operation.type === "splitNode") {
    const targetPath = operation.pos.path.slice(0, operation.pos.path.length - operation.depth);
    const parentPath = targetPath.slice(0, -1);
    const targetIndex = targetPath[targetPath.length - 1];
    if (samePath(pos.path, targetPath) && pos.offset > operation.pos.offset) {
      return { pos: { path: [...parentPath, targetIndex + 1], offset: pos.offset - operation.pos.offset }, deleted: false };
    }
    if (samePath(pos.path, parentPath) && pos.offset > targetIndex) {
      return { pos: { ...pos, offset: pos.offset + 1 }, deleted: false };
    }
    if (samePath(pos.path.slice(0, parentPath.length), parentPath) && pos.path.length > parentPath.length && pos.path[parentPath.length] > targetIndex) {
      const path = [...pos.path];
      path[parentPath.length] += 1;
      return { pos: { ...pos, path }, deleted: false };
    }
    if (samePath(pos.path.slice(0, targetPath.length), targetPath) && pos.path.length > targetPath.length) {
      const childIndex = pos.path[targetPath.length];
      if (childIndex >= operation.pos.offset) {
        return { pos: { ...pos, path: [...parentPath, targetIndex + 1, childIndex - operation.pos.offset, ...pos.path.slice(targetPath.length + 1)] }, deleted: false };
      }
    }
  }
  if (operation.type === "mergeNode") {
    const rightPath = [...operation.pos.path, operation.pos.offset];
    const leftPath = [...operation.pos.path, operation.pos.offset - 1];
    if (samePath(pos.path, rightPath)) {
      return { pos: { path: leftPath, offset: operation.splitOffset + pos.offset }, deleted: false };
    }
    if (samePath(pos.path.slice(0, rightPath.length), rightPath) && pos.path.length > rightPath.length) {
      return { pos: { ...pos, path: [...leftPath, operation.splitOffset + pos.path[rightPath.length], ...pos.path.slice(rightPath.length + 1)] }, deleted: false };
    }
    if (samePath(pos.path, operation.pos.path) && pos.offset > operation.pos.offset) {
      return { pos: { ...pos, offset: pos.offset - 1 }, deleted: false };
    }
    if (samePath(pos.path.slice(0, operation.pos.path.length), operation.pos.path) && pos.path.length > operation.pos.path.length && pos.path[operation.pos.path.length] > operation.pos.offset) {
      const path = [...pos.path];
      path[operation.pos.path.length] -= 1;
      return { pos: { ...pos, path }, deleted: false };
    }
  }
  if (operation.type === "insertText" && samePath(pos.path, operation.pos.path)) {
    if (pos.offset > operation.pos.offset || (pos.offset === operation.pos.offset && bias > 0)) return { pos: { ...pos, offset: pos.offset + operation.text.length }, deleted: false };
  }
  if (operation.type === "deleteText" && samePath(pos.path, operation.pos.path)) {
    const end = operation.pos.offset + operation.text.length;
    if (pos.offset > operation.pos.offset && pos.offset <= end) return { pos: { ...pos, offset: operation.pos.offset }, deleted: true };
    if (pos.offset > end) return { pos: { ...pos, offset: pos.offset - operation.text.length }, deleted: false };
  }
  return { pos: { path: [...pos.path], offset: pos.offset }, deleted: false };
};

export const mapOperation = (operation: SmartOperation, through: SmartOperation): SmartOperation | null => {
  const map = (pos: SmartPos, bias: -1 | 1 = 1) => mapPosThroughOperation(pos, through, bias);
  if (operation.type === "insertNode" || operation.type === "removeNode" || operation.type === "replaceNode") {
    const result = map(operation.pos);
    return result.deleted ? null : { ...operation, pos: result.pos };
  }
  if (operation.type === "moveNode") {
    const from = map(operation.from);
    const to = map(operation.to);
    return from.deleted ? null : { ...operation, from: from.pos, to: to.pos };
  }
  if (operation.type === "splitNode" || operation.type === "mergeNode" || operation.type === "setNodeAttributes" || operation.type === "insertText" || operation.type === "deleteText") {
    const result = map(operation.pos);
    return result.deleted ? null : { ...operation, pos: result.pos };
  }
  const from = map(operation.range.from, -1);
  const to = map(operation.range.to, 1);
  return from.deleted && to.deleted ? null : { ...operation, range: { from: from.pos, to: to.pos } };
};
