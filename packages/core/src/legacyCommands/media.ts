import type { LegacyCommandContext, SmartCommand } from "../command.js";
import {
  getNodeAtPath,
  type Path,
  type SmartBlockNode,
  type SmartImageNode,
  type SmartInlineImageNode,
  type SmartInlineNode,
  type SmartMediaNode,
  type LegacySmartTextNode,
} from "../model.js";
import { isSmartContainer } from "../tree.js";
import { createDeleteInlineAtomCommand } from "./inlineAtoms.js";

const blockTypes = new Set([
  "paragraph", "heading", "list", "blockquote", "codeBlock", "image", "media", "table",
]);

const isBlock = (node: unknown): node is SmartBlockNode =>
  Boolean(node) && typeof node === "object" &&
  blockTypes.has(String((node as { type?: unknown }).type));

const canContainBlocks = (node: unknown) => {
  const type = (node as { type?: unknown } | undefined)?.type;
  return type === "doc" || type === "listItem" || type === "blockquote" ||
    type === "tableCell" || type === "tableHeaderCell";
};

const resolveInsertionPath = (context: LegacyCommandContext, explicit?: Path): Path | null => {
  if (explicit) {
    const parent = getNodeAtPath(context.document, explicit.slice(0, -1));
    const index = explicit[explicit.length - 1];
    return explicit.length > 0 && canContainBlocks(parent) && isSmartContainer(parent) &&
      Number.isInteger(index) && index >= 0 && index <= parent.children.length
      ? [...explicit]
      : null;
  }
  if (context.selection.type === "all") return [context.document.children.length];
  let path: Path | undefined;
  if (context.selection.type === "node") path = context.selection.path;
  if (context.selection.type === "text") path = context.selection.focus.path;
  if (context.selection.type === "cell") {
    path = [
      ...context.selection.tablePath,
      context.selection.start.row,
      context.selection.start.column,
    ];
  }
  if (!path) return null;
  for (let length = path.length; length > 0; length -= 1) {
    const candidatePath = path.slice(0, length);
    if (!isBlock(getNodeAtPath(context.document, candidatePath))) continue;
    const parent = getNodeAtPath(context.document, candidatePath.slice(0, -1));
    if (!canContainBlocks(parent)) continue;
    return [
      ...candidatePath.slice(0, -1),
      candidatePath[candidatePath.length - 1] + 1,
    ];
  }
  const selected = getNodeAtPath(context.document, path);
  if (canContainBlocks(selected) && isSmartContainer(selected)) {
    return [...path, selected.children.length];
  }
  return null;
};

const insertBlockTransaction = (
  context: LegacyCommandContext,
  id: string,
  path: Path,
  node: SmartImageNode | SmartMediaNode,
) => ({
  id,
  source: "user" as const,
  operations: [{ type: "insertNode" as const, path, node }],
  selectionBefore: context.selection,
  selectionAfter: { type: "node" as const, path },
  addToHistory: true,
  timestamp: context.now?.() ?? Date.now(),
});

export interface InsertImageInput {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  path?: Path;
}

export interface InsertInlineImageInput extends InsertImageInput {}

const validImageInput = (input: InsertImageInput | undefined) =>
  Boolean(input?.src.trim()) &&
  (input?.width === undefined || Number.isFinite(input.width) && input.width > 0) &&
  (input?.height === undefined || Number.isFinite(input.height) && input.height > 0);

export const insertImage: SmartCommand<InsertImageInput> = {
  id: "image.insert",
  isEnabled: (context, input) =>
    validImageInput(input) && Boolean(resolveInsertionPath(context, input?.path)),
  execute: (context, input) => {
    const path = input && resolveInsertionPath(context, input.path);
    if (!input || !validImageInput(input) || !path) {
      throw new Error("image.insert requires a valid image and block insertion path.");
    }
    return insertBlockTransaction(context, "image.insert", path, {
      type: "image",
      src: input.src.trim(),
      ...(input.alt ? { alt: input.alt } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    });
  },
};

const resolveInlineImageTarget = (context: LegacyCommandContext) => {
  if (context.selection.type !== "text") return null;
  const { anchor, focus } = context.selection;
  if (
    anchor.offset !== focus.offset ||
    anchor.path.length !== focus.path.length ||
    !anchor.path.every((part, index) => focus.path[index] === part)
  ) return null;
  const node = getNodeAtPath(context.document, anchor.path) as LegacySmartTextNode | undefined;
  const parentPath = anchor.path.slice(0, -1);
  const parent = getNodeAtPath(context.document, parentPath);
  if (
    node?.type !== "text" ||
    !isSmartContainer(parent) ||
    !["paragraph", "heading"].includes(String((parent as { type?: unknown }).type)) ||
    anchor.offset < 0 ||
    anchor.offset > node.text.length
  ) return null;
  return { node, parent, parentPath, index: anchor.path[anchor.path.length - 1], offset: anchor.offset };
};

export const insertInlineImage: SmartCommand<InsertInlineImageInput> = {
  id: "image.insert-inline",
  isEnabled: (context, input) =>
    validImageInput(input) && Boolean(resolveInlineImageTarget(context)),
  execute: (context, input) => {
    const target = resolveInlineImageTarget(context);
    if (!input || !validImageInput(input) || !target) {
      throw new Error("image.insert-inline requires a collapsed selection in paragraph or heading text.");
    }
    const image: SmartInlineImageNode = {
      type: "inlineImage",
      src: input.src.trim(),
      ...(input.alt ? { alt: input.alt } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    };
    const replacement: SmartInlineNode[] = [];
    if (target.offset > 0) {
      replacement.push({ ...target.node, text: target.node.text.slice(0, target.offset) });
    }
    replacement.push(image);
    replacement.push({ ...target.node, text: target.node.text.slice(target.offset) });
    const imageIndex = target.index + (target.offset > 0 ? 1 : 0);
    return {
      id: "image.insert-inline",
      source: "user",
      operations: [{
        type: "replaceNode",
        path: target.parentPath,
        node: {
          ...(target.parent as object),
          children: [
            ...target.parent.children.slice(0, target.index),
            ...replacement,
            ...target.parent.children.slice(target.index + 1),
          ],
        },
      }],
      selectionBefore: context.selection,
      selectionAfter: {
        type: "text",
        anchor: { path: [...target.parentPath, imageIndex + 1], offset: 0 },
        focus: { path: [...target.parentPath, imageIndex + 1], offset: 0 },
      },
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export const deleteInlineImage = createDeleteInlineAtomCommand("image.delete-inline", "inlineImage");

export interface UpdateInlineImageInput {
  path: Path;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export const updateInlineImage: SmartCommand<UpdateInlineImageInput> = {
  id: "image.update-inline",
  isEnabled: (context, input) => {
    const node = input && getNodeAtPath(context.document, input.path);
    return Boolean(
      node && (node as { type?: unknown }).type === "inlineImage" &&
      (input?.width === undefined || Number.isFinite(input.width) && input.width > 0) &&
      (input?.height === undefined || Number.isFinite(input.height) && input.height > 0),
    );
  },
  execute: (context, input) => {
    if (!input || !updateInlineImage.isEnabled(context, input)) {
      throw new Error("image.update-inline requires a valid inline image path and dimensions.");
    }
    return {
      id: "image.update-inline",
      source: "user",
      operations: [{
        type: "setNodeAttrs",
        path: input.path,
        attrs: {
          alt: input.alt,
          title: input.title,
          width: input.width,
          height: input.height,
        },
      }],
      selectionBefore: context.selection,
      selectionAfter: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};

export interface InsertMediaInput {
  src: string;
  mediaType: "audio" | "video" | "file";
  title?: string;
  mimeType?: string;
  path?: Path;
}

const validMediaInput = (input: InsertMediaInput | undefined) =>
  Boolean(input?.src.trim()) && Boolean(input && ["audio", "video", "file"].includes(input.mediaType));

export const insertMedia: SmartCommand<InsertMediaInput> = {
  id: "media.insert",
  isEnabled: (context, input) =>
    validMediaInput(input) && Boolean(resolveInsertionPath(context, input?.path)),
  execute: (context, input) => {
    const path = input && resolveInsertionPath(context, input.path);
    if (!input || !validMediaInput(input) || !path) {
      throw new Error("media.insert requires valid media and a block insertion path.");
    }
    return insertBlockTransaction(context, "media.insert", path, {
      type: "media",
      src: input.src.trim(),
      mediaType: input.mediaType,
      ...(input.title ? { title: input.title } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    });
  },
};
