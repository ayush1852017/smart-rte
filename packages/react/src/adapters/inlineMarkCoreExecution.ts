import {
  applyTransaction,
  toggleBold,
  toggleItalic,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
  type SmartCommand,
  type SmartEditorState,
  type SmartSelection,
} from "smartrte-core";
import { selectionFromDom } from "./domSelectionBridge.js";
import { serializeSmartDocument, smartDocumentFromEditorRoot } from "./domSmartDocument.js";
import { isCoreInlineMarkFlagEnabled } from "./internalFlags.js";

export type CoreInlineMark = "bold" | "italic" | "underline" | "superscript" | "subscript";

const commands: Record<CoreInlineMark, SmartCommand<void>> = {
  bold: toggleBold,
  italic: toggleItalic,
  underline: toggleUnderline,
  superscript: toggleSuperscript,
  subscript: toggleSubscript,
};

export interface CoreInlineMarkResult {
  html: string;
  selectionBefore: SmartSelection;
  selectionAfter: SmartSelection;
}

export const isCoreInlineMarkEnabled = (mark: CoreInlineMark) =>
  isCoreInlineMarkFlagEnabled(mark);

export const getCoreInlineMarkResult = (root: HTMLElement, mark: CoreInlineMark): CoreInlineMarkResult | null => {
  const selection = selectionFromDom(root, window.getSelection());
  if (!selection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const state: SmartEditorState = { document, selection };
  const command = commands[mark];
  if (!command.isEnabled(state)) return null;
  const transaction = command.execute(state);
  const next = applyTransaction(state, transaction);
  return { html: serializeSmartDocument(next.document), selectionBefore: transaction.selectionBefore, selectionAfter: transaction.selectionAfter };
};
