import { getNodeAtPath, type Path, type LegacySmartDocument, type TextAlignment } from "../model.js";
import type { LegacySmartSelection } from "../selection.js";
import type { LegacySmartTransaction } from "../transaction.js";
import { replaceNodeAtPath } from "../tree.js";
import type { SmartCommand } from "../command.js";

export interface SetTextAlignmentInput {
  paths: readonly Path[];
  alignment: TextAlignment | null;
}

export const setTextAlignment = (
  document: LegacySmartDocument,
  selection: LegacySmartSelection,
  input: SetTextAlignmentInput
) => {
  const uniquePaths = Array.from(new Map(input.paths.map((path) => [path.join("."), path])).values());
  if (uniquePaths.length === 0) throw new Error("At least one aligned block path is required.");
  let nextDocument = document;
  const operations: LegacySmartTransaction["operations"] = [];

  uniquePaths.forEach((path) => {
    const node = getNodeAtPath(nextDocument, path) as { type?: string; alignment?: TextAlignment } | undefined;
    if (!node || !["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type || "")) {
      throw new Error("Alignment path must resolve to an alignable block.");
    }
    const replacement = { ...node };
    if (!input.alignment || input.alignment === "left") delete replacement.alignment;
    else replacement.alignment = input.alignment;
    nextDocument = replaceNodeAtPath(nextDocument, path, replacement);
    operations.push({ type: "replaceNode", path, node: replacement });
  });

  return {
    document: nextDocument,
    transaction: {
      id: "set-text-alignment",
      source: "user" as const,
      operations,
      selectionBefore: selection,
      selectionAfter: selection,
      addToHistory: true,
      timestamp: Date.now(),
    },
  };
};

export const setAlignment: SmartCommand<SetTextAlignmentInput> = {
  id: "alignment.set",
  isEnabled: (context, input) => {
    if (!input?.paths.length) return false;
    return input.paths.every((path) => {
      const type = (getNodeAtPath(context.document, path) as { type?: string } | undefined)?.type;
      return ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(type || "");
    });
  },
  execute: (context, input) => {
    if (!input || !setAlignment.isEnabled(context, input)) {
      throw new Error("alignment.set requires alignable block paths.");
    }
    return setTextAlignment(context.document, context.selection, input).transaction;
  },
};
