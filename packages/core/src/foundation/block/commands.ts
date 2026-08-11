import { cloneNode, isTextNode } from "../identity.js";
import { moveContiguousSiblings } from "../structural/move.js";
import type { BlockRangeScope, MixedScope, ResolvedScope } from "../scope/types.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartMark, SmartOperation, SmartPos } from "../types.js";
import type {
  BlockCommand, BlockCommandContext, IndentBlocksParams, MoveBlocksParams,
  OutdentBlocksParams, SetBlockAttributesParams, SetBlockTypeParams,
  UnwrapBlocksParams, WrapBlocksParams,
} from "./types.js";

interface LocatedBlock { readonly node: SmartElementNode; readonly pos: SmartPos }

const cleanAttrs = (attrs: Attrs): Attrs => Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));

const blockScopes = (scope: ResolvedScope): BlockRangeScope[] => {
  if (scope.kind === "block-range") return [scope];
  if (scope.kind !== "mixed") return [];
  const collect = (mixed: MixedScope): BlockRangeScope[] => mixed.parts.flatMap((part) =>
    part.kind === "block-range" ? [part] : part.kind === "mixed" ? collect(part) : []);
  return collect(scope);
};

const selectedBlockIds = (scope: ResolvedScope): string[] => [...new Set(blockScopes(scope).flatMap((entry) => entry.blockIds))];

const locate = (nodeId: string, ctx: BlockCommandContext): LocatedBlock => {
  const resolved = ctx.positions.positionOf(nodeId);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node || isTextNode(node) || node.id !== nodeId) throw new Error(`Unknown or stale block ID "${nodeId}".`);
  return { node, pos: { path: [...resolved.pos.path], offset: resolved.pos.offset } };
};

const semanticRole = (node: SmartElementNode, ctx: BlockCommandContext) =>
  ctx.schema.nodes[node.type]?.semanticRole || node.type;

const ancestorWithRole = (
  nodeId: string,
  role: "list" | "blockquote",
  ctx: BlockCommandContext,
): SmartElementNode | null => {
  const resolved = ctx.positions.positionOf(nodeId);
  if (!resolved) return null;
  for (let index = resolved.ancestors.length - 1; index >= 0; index -= 1) {
    const candidate = resolved.ancestors[index];
    if (semanticRole(candidate, ctx) === role) return candidate;
  }
  return null;
};

const ancestorTargets = (
  scope: ResolvedScope,
  role: "list" | "blockquote",
  ctx: BlockCommandContext,
) => {
  const targets = new Map<string, LocatedBlock>();
  selectedBlockIds(scope).forEach((nodeId) => {
    const ancestor = ancestorWithRole(nodeId, role, ctx);
    if (!ancestor || targets.has(ancestor.id)) return;
    targets.set(ancestor.id, locate(ancestor.id, ctx));
  });
  return [...targets.values()].sort((left, right) =>
    right.pos.path.length - left.pos.path.length || right.pos.offset - left.pos.offset);
};

const typeAttrs = (node: SmartElementNode, type: SetBlockTypeParams["type"], attrs: Attrs | undefined): Attrs => {
  const next = { ...(node.attrs || {}) } as Record<string, unknown>;
  delete next.level;
  delete next.language;
  Object.assign(next, attrs || {});
  if (type === "heading" && next.level === undefined) next.level = 1;
  return cleanAttrs(next);
};

const uniqueMarks = (node: SmartElementNode): SmartMark[] => {
  const marks = new Map<string, SmartMark>();
  node.children?.forEach((child) => {
    if (!isTextNode(child)) return;
    child.marks?.forEach((mark) => marks.set(JSON.stringify(mark), mark));
  });
  return [...marks.values()];
};

export const setBlockTypeCommand: BlockCommand<SetBlockTypeParams> = (_document, scope, params, ctx) =>
  selectedBlockIds(scope).flatMap((nodeId) => {
    const { node, pos } = locate(nodeId, ctx);
    if (!["paragraph", "heading", "code_block"].includes(node.type)) return [];
    const afterAttrs = typeAttrs(node, params.type, params.attrs);
    if (node.type === params.type) {
      return JSON.stringify(node.attrs || {}) === JSON.stringify(afterAttrs) ? [] : [{
        type: "setNodeAttributes" as const,
        pos: { path: [...pos.path, pos.offset], offset: 0 },
        before: node.attrs || {},
        after: afterAttrs,
      }];
    }
    const operations: SmartOperation[] = [];
    if (params.type === "code_block") {
      const range = ctx.positions.contentRangeOf(node.id);
      if (!range) return [];
      uniqueMarks(node).forEach((mark) => operations.push({ type: "removeMark", range, mark }));
    }
    operations.push({
      type: "setNodeType",
      pos: { path: [...pos.path, pos.offset], offset: 0 },
      before: node.type,
      after: params.type,
      beforeAttrs: node.attrs || {},
      afterAttrs,
    });
    return operations;
  });

const groupedBlocks = (scope: ResolvedScope, ctx: BlockCommandContext) => {
  const entries = selectedBlockIds(scope).map((nodeId) => ({ nodeId, ...locate(nodeId, ctx) }));
  const byParent = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    const key = JSON.stringify(entry.pos.path);
    byParent.set(key, [...(byParent.get(key) || []), entry]);
  });
  return [...byParent.values()].map((group) => group.sort((a, b) => a.pos.offset - b.pos.offset))
    .filter((group) => group.every((entry, index) => index === 0 || entry.pos.offset === group[index - 1].pos.offset + 1))
    .sort((left, right) => right[0].pos.offset - left[0].pos.offset);
};

export const wrapBlocks: BlockCommand<WrapBlocksParams> = (_document, scope, params, ctx) => {
  const groups = groupedBlocks(scope, ctx);
  const listTargets = ancestorTargets(scope, "list", ctx);
  const nonListGroups = groups.filter((group) => !ancestorWithRole(group[0].node.id, "list", ctx));
  const targetCount = listTargets.length + nonListGroups.length;
  if (params.wrapperIds.length < targetCount) throw new Error(`block.wrap requires ${targetCount} caller-provided wrapper ID(s).`);
  let wrapperCursor = 0;
  const listOperations = listTargets.map(({ node, pos }) => {
    const wrapper: SmartElementNode = {
      type: params.type,
      id: params.wrapperIds[wrapperCursor++],
      ...(params.attrs && Object.keys(params.attrs).length ? { attrs: cleanAttrs(params.attrs) } : {}),
      children: [cloneNode(node)],
    };
    return { type: "replaceNode" as const, pos, before: node, after: wrapper };
  });
  const blockOperations = nonListGroups.flatMap((group) => {
    const first = group[0];
    const wrapper: SmartElementNode = {
      type: params.type,
      id: params.wrapperIds[wrapperCursor++],
      ...(params.attrs && Object.keys(params.attrs).length ? { attrs: cleanAttrs(params.attrs) } : {}),
      children: group.map((entry) => cloneNode(entry.node)),
    };
    const operations: SmartOperation[] = [{ type: "replaceNode", pos: first.pos, before: first.node, after: wrapper }];
    group.slice(1).forEach((entry) => operations.push({
      type: "removeNode",
      pos: { path: [...first.pos.path], offset: first.pos.offset + 1 },
      node: entry.node,
    }));
    return operations;
  });
  return [...listOperations, ...blockOperations];
};

export const unwrapBlocks: BlockCommand<UnwrapBlocksParams> = (_document, scope, params, ctx) => {
  const wrapperType = params.type || "blockquote";
  const wrappers = new Map<string, LocatedBlock>();
  selectedBlockIds(scope).forEach((nodeId) => {
    const selected = locate(nodeId, ctx);
    const target = selected.node.type === wrapperType
      ? selected.node
      : ancestorWithRole(nodeId, wrapperType === "blockquote" ? "blockquote" : wrapperType, ctx);
    if (!target || wrappers.has(target.id)) return;
    wrappers.set(target.id, locate(target.id, ctx));
  });
  return [...wrappers.values()].sort((left, right) =>
    right.pos.path.length - left.pos.path.length || right.pos.offset - left.pos.offset).flatMap(({ node, pos }) => {
    if (node.type !== wrapperType) return [];
    const children = (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child));
    if (!children.length) return [];
    const operations: SmartOperation[] = [{ type: "replaceNode", pos, before: node, after: cloneNode(children[0]) }];
    children.slice(1).forEach((child, index) => operations.push({
      type: "insertNode",
      pos: { path: [...pos.path], offset: pos.offset + index + 1 },
      node: cloneNode(child),
    }));
    return operations;
  });
};

export const setBlockAttributes: BlockCommand<SetBlockAttributesParams> = (_document, scope, params, ctx) =>
  selectedBlockIds(scope).flatMap((nodeId) => {
    const { node, pos } = locate(nodeId, ctx);
    const after = cleanAttrs({ ...(node.attrs || {}), ...params.attrs });
    return JSON.stringify(node.attrs || {}) === JSON.stringify(after) ? [] : [{
      type: "setNodeAttributes" as const,
      pos: { path: [...pos.path, pos.offset], offset: 0 },
      before: node.attrs || {},
      after,
    }];
  });

export const moveBlockCommand: BlockCommand<MoveBlocksParams> = (_document, scope, params, ctx) =>
  moveContiguousSiblings(selectedBlockIds(scope), params.direction, ctx);

const changeIndent = (
  scope: ResolvedScope,
  amount: number,
  ctx: BlockCommandContext,
): SmartOperation[] => selectedBlockIds(scope).flatMap((nodeId) => {
  const { node, pos } = locate(nodeId, ctx);
  const current = Number(node.attrs?.indentLevel) || 0;
  const indentLevel = Math.max(0, Math.min(10, current + amount));
  if (indentLevel === current) return [];
  return [{
    type: "setNodeAttributes" as const,
    pos: { path: [...pos.path, pos.offset], offset: 0 },
    before: node.attrs || {},
    after: cleanAttrs({ ...(node.attrs || {}), indentLevel: indentLevel || undefined }),
  }];
});

export const indentBlockCommand: BlockCommand<IndentBlocksParams> = (_document, scope, params, ctx) =>
  changeIndent(scope, Math.max(1, params.amount || 1), ctx);

export const outdentBlockCommand: BlockCommand<OutdentBlocksParams> = (_document, scope, params, ctx) =>
  changeIndent(scope, -Math.max(1, params.amount || 1), ctx);

export const blockCommands = {
  "block.setType": setBlockTypeCommand,
  "block.wrap": wrapBlocks,
  "block.unwrap": unwrapBlocks,
  "block.setAttributes": setBlockAttributes,
  "block.move": moveBlockCommand,
  "block.indent": indentBlockCommand,
  "block.outdent": outdentBlockCommand,
} as const;
