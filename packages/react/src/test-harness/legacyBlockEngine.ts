/**
 * Test-only Phase 5 snapshot of the legacy block command engine.
 *
 * This harness must be committed before production block paths are deleted.
 * Product code must never import it. It exists so shadow comparison remains
 * executable after ClassicEditor routes through canonical block commands.
 */
import {
  applyTransaction,
  indentBlocks,
  moveBlocks,
  setAlignment,
  setBlockType,
  toggleBlockquote,
  toggleCodeBlock,
  type SmartCommand,
  type SmartEditorState,
} from "smartrte-core/legacy";
import { selectionFromDom } from "../adapters/domSelectionBridge.js";
import { serializeSmartDocument, smartDocumentFromEditorRoot } from "../adapters/domSmartDocument.js";

export type LegacyBlockToolId =
  | "setType" | "blockquote" | "codeBlock" | "alignment" | "indent" | "move";

export type LegacyBlockInput =
  | { parentPath: readonly number[]; blockIndexes: readonly number[]; type: "paragraph" | "heading"; level?: 1 | 2 | 3 | 4 | 5 | 6 }
  | { parentPath: readonly number[]; blockIndexes: readonly number[] }
  | { paths: readonly (readonly number[])[]; alignment: "left" | "center" | "right" | "justify" | null }
  | { parentPath: readonly number[]; blockIndexes: readonly number[]; direction: "indent" | "outdent" | "up" | "down" };

const commands: Readonly<Record<LegacyBlockToolId, SmartCommand<unknown>>> = Object.freeze({
  setType: setBlockType as SmartCommand<unknown>,
  blockquote: toggleBlockquote as SmartCommand<unknown>,
  codeBlock: toggleCodeBlock as SmartCommand<unknown>,
  alignment: setAlignment as SmartCommand<unknown>,
  indent: indentBlocks as SmartCommand<unknown>,
  move: moveBlocks as SmartCommand<unknown>,
});

export const legacyBlockToolIds = Object.freeze(Object.keys(commands) as LegacyBlockToolId[]);

export interface LegacyBlockResult {
  readonly html: string;
  readonly selection: SmartEditorState["selection"];
}

export const runLegacyBlockTool = (
  root: HTMLElement,
  tool: LegacyBlockToolId,
  input: LegacyBlockInput,
): LegacyBlockResult | null => {
  const selection = selectionFromDom(root, root.ownerDocument.getSelection());
  if (!selection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const state: SmartEditorState = { document, selection };
  const command = commands[tool];
  if (!command.isEnabled(state, input)) return null;
  const next = applyTransaction(state, command.execute(state, input));
  return { html: serializeSmartDocument(next.document), selection: next.selection };
};
