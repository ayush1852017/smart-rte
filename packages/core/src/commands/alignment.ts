import { getNodeAtPath, type Path, type SmartDocument, type TextAlignment } from "../model.js";
import type { SmartSelection } from "../selection.js";
import type { SmartTransaction } from "../transaction.js";
import { replaceNodeAtPath } from "../tree.js";

export interface SetTextAlignmentInput {
  paths: readonly Path[];
  alignment: TextAlignment | null;
}

export const setTextAlignment = (
  document: SmartDocument,
  selection: SmartSelection,
  input: SetTextAlignmentInput
) => {
  const uniquePaths = Array.from(new Map(input.paths.map((path) => [path.join("."), path])).values());
  if (uniquePaths.length === 0) throw new Error("At least one aligned block path is required.");
  let nextDocument = document;
  const operations: SmartTransaction["operations"] = [];

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
