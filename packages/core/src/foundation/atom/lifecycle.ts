import type { FoundationEditor } from "../editor.js";
import { isTextNode } from "../identity.js";
import type { Attrs, SmartElementNode } from "../types.js";

export interface AtomUploadCompletion { readonly src?: string; readonly error?: string }

/** Applies upload completion outside the insertion transaction and never resurrects deleted nodes. */
export const completeAtomUpload = (editor: FoundationEditor, nodeId: string, completion: AtomUploadCompletion): boolean => {
  const resolved = editor.positions.positionOf(nodeId);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node || isTextNode(node) || node.id !== nodeId) return false;
  const before = node.attrs || {};
  const after: Attrs = completion.src
    ? { ...before, src: completion.src, status: "ready", uploadId: undefined, error: undefined }
    : { ...before, status: "error", uploadId: undefined, error: completion.error || "Upload failed" };
  editor.transact((transaction) => transaction.operations.push({
    type: "setNodeAttributes", pos: { path: [...resolved.pos.path, resolved.pos.offset], offset: 0 }, before, after: Object.fromEntries(Object.entries(after).filter(([, value]) => value !== undefined)),
  }), { source: "api", addToHistory: false });
  return true;
};

export const runAtomUpload = async (
  editor: FoundationEditor,
  nodeId: string,
  upload: () => Promise<{ src: string }>,
): Promise<boolean> => {
  try { return completeAtomUpload(editor, nodeId, await upload()); }
  catch (error) { return completeAtomUpload(editor, nodeId, { error: error instanceof Error ? error.message : "Upload failed" }); }
};
