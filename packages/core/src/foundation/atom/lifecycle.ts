import type { FoundationEditor } from "../editor.js";
import { isTextNode } from "../identity.js";
import type { Attrs, SmartElementNode } from "../types.js";
import { atomDeclarations } from "./declarations.js";
import { sanitizeAtomSource } from "./security.js";

export interface AtomUploadCompletion { readonly src?: string; readonly id?: string; readonly error?: string }

/** Applies upload completion outside the insertion transaction and never resurrects deleted nodes. */
export const completeAtomUpload = (editor: FoundationEditor, nodeId: string, completion: AtomUploadCompletion): boolean => {
  const resolved = editor.positions.positionOf(nodeId);
  if (!resolved) return false;
  const index = resolved.kind === "inline" ? (() => {
    let offset = 0;
    for (let childIndex = 0; childIndex < (resolved.parent.children?.length || 0); childIndex += 1) {
      const child = resolved.parent.children![childIndex];
      if (!isTextNode(child) && child.id === nodeId && offset === resolved.pos.offset) return childIndex;
      offset += isTextNode(child) ? child.text.length : 1;
    }
    return -1;
  })() : resolved.pos.offset;
  const node = resolved.parent.children?.[index];
  if (!node || isTextNode(node) || node.id !== nodeId) return false;
  const before = node.attrs || {};
  const declaration = atomDeclarations.find((entry) => entry.type === node.type);
  const safeSource = completion.src && declaration && declaration.kind !== "formula"
    ? sanitizeAtomSource(completion.src, { kind: declaration.kind }) : null;
  const after: Attrs = safeSource
    ? { ...before, src: safeSource, status: "ready", ...(completion.id ? { uploadId: completion.id } : { uploadId: undefined }), error: undefined }
    : { ...before, status: "error", uploadId: undefined, error: completion.error || "Upload failed" };
  editor.transact((transaction) => transaction.operations.push({
    type: "setNodeAttributes", pos: { path: [...resolved.pos.path, index], offset: 0 }, before, after: Object.fromEntries(Object.entries(after).filter(([, value]) => value !== undefined)),
  }), { source: "api", addToHistory: false });
  return true;
};

export const runAtomUpload = async (
  editor: FoundationEditor,
  nodeId: string,
  upload: () => Promise<{ src: string; id?: string }>,
): Promise<boolean> => {
  try { return completeAtomUpload(editor, nodeId, await upload()); }
  catch (error) { return completeAtomUpload(editor, nodeId, { error: error instanceof Error ? error.message : "Upload failed" }); }
};
