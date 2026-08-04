import { isTextNode } from "../identity.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartNode, SmartOperation } from "../types.js";
import type { ResolvedScope } from "../scope/types.js";
import type { AtomCommand, AtomCommandContext, InsertAtomParams, ResizeAtomParams, UpdateAtomParams } from "./types.js";

const locate = (document: SmartDocument, id: string, ctx: AtomCommandContext) => {
  const resolved = ctx.positions.positionOf(id);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node || isTextNode(node) || node.id !== id) return null;
  return { node, pos: resolved.pos };
};

const cleanAttrs = (attrs: Attrs): Attrs => Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));

const inlineChildrenWithAtom = (owner: SmartElementNode, offset: number, atom: SmartElementNode): SmartNode[] | null => {
  if (!Number.isInteger(offset) || offset < 0) return null;
  const output: SmartNode[] = [];
  let cursor = 0;
  let inserted = false;
  for (const child of owner.children || []) {
    const width = isTextNode(child) ? child.text.length : 1;
    if (!inserted && offset >= cursor && offset <= cursor + width) {
      if (isTextNode(child)) {
        const local = offset - cursor;
        if (local) output.push({ ...child, text: child.text.slice(0, local) });
        output.push(atom);
        if (local < child.text.length) output.push({ ...child, text: child.text.slice(local) });
      } else {
        if (offset === cursor) output.push(atom, child);
        else if (offset === cursor + 1) output.push(child, atom);
        else return null;
      }
      inserted = true;
    } else output.push(child);
    cursor += width;
  }
  if (!inserted && offset === cursor) output.push(atom);
  return inserted || offset === cursor ? output : null;
};

export const insertAtom: AtomCommand<InsertAtomParams> = (document, _scope, params, ctx) => {
  const attrs = cleanAttrs(params.attrs);
  if (!params.declaration.validate(attrs)) return [];
  const node: SmartElementNode = { type: params.declaration.type, id: params.nodeId, attrs };
  if (params.declaration.group === "inline") {
    if (!params.ownerId || params.offset === undefined) return [];
    const owner = locate(document, params.ownerId, ctx);
    if (!owner) return [];
    const children = inlineChildrenWithAtom(owner.node, params.offset, node);
    return children ? [{ type: "replaceNode", pos: owner.pos, before: owner.node, after: { ...owner.node, children } }] : [];
  }
  if (!params.parentId || params.index === undefined) return [];
  const range = ctx.positions.contentRangeOf(params.parentId);
  const parentPosition = ctx.positions.positionOf(params.parentId);
  const parent = parentPosition?.parent.children?.[parentPosition.pos.offset];
  if (!range || !parent || isTextNode(parent) || params.index < 0 || params.index > (parent.children?.length || 0)) return [];
  return [{ type: "insertNode", pos: { path: [...range.from.path], offset: params.index }, node }];
};

const atomIds = (scope: ResolvedScope): string[] => scope.kind === "atomic-node" ? [scope.nodeId]
  : scope.kind === "mixed" ? scope.parts.flatMap(atomIds) : [];

export const updateAtom: AtomCommand<UpdateAtomParams> = (document, scope, params, ctx) => atomIds(scope).flatMap((id) => {
  const located = locate(document, id, ctx);
  if (!located || ctx.schema.nodes[located.node.type]?.atomic !== true) return [];
  return [{ type: "setNodeAttributes", pos: { path: [...located.pos.path, located.pos.offset], offset: 0 }, before: located.node.attrs || {}, after: cleanAttrs({ ...(located.node.attrs || {}), ...params.attrs }) }];
});

export const deleteAtom: AtomCommand<Record<string, never>> = (document, scope, _params, ctx) => atomIds(scope).flatMap((id) => {
  const located = locate(document, id, ctx);
  return located && ctx.schema.nodes[located.node.type]?.atomic === true
    ? [{ type: "removeNode", pos: located.pos, node: located.node } as SmartOperation] : [];
});

export const resizeAtom: AtomCommand<ResizeAtomParams> = (document, scope, params, ctx) => {
  const id = atomIds(scope)[0];
  const located = id ? locate(document, id, ctx) : null;
  if (!located) return [];
  const beforeWidth = Number(located.node.attrs?.width) || params.width;
  const beforeHeight = Number(located.node.attrs?.height) || params.height;
  const minWidth = Math.max(1, params.minWidth || 16);
  const minHeight = Math.max(1, params.minHeight || 16);
  let width = Math.max(minWidth, params.width);
  let height = Math.max(minHeight, params.height);
  if (params.preserveAspectRatio && beforeWidth > 0 && beforeHeight > 0) height = width * beforeHeight / beforeWidth;
  if (![width, height].every((value) => Number.isFinite(value) && value <= 100_000)) return [];
  return updateAtom(document, scope, { attrs: { width, height } }, ctx);
};

export const atomCommands = { "atom.insert": insertAtom, "atom.update": updateAtom, "atom.delete": deleteAtom, "atom.resize": resizeAtom } as const;
