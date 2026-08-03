/**
 * Test-only Phase 4 snapshot of the legacy inline command engine.
 *
 * This file was created before production inline handlers are removed. It must
 * never be imported by product code. The shadow corpus keeps it so comparison
 * remains possible after ClassicEditor routes exclusively to foundation marks.
 */
import {
  applyBackgroundColor,
  applyFontFamily,
  applyFontSize,
  applyLink,
  applyTextColor,
  applyTransaction,
  removeLink,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrike,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
  updateLink,
  type SmartCommand,
  type SmartEditorState,
} from "smartrte-core/legacy";
import { selectionFromDom } from "../adapters/domSelectionBridge.js";
import { serializeSmartDocument, smartDocumentFromEditorRoot } from "../adapters/domSmartDocument.js";

export type LegacyInlineToolId =
  | "bold" | "italic" | "underline" | "strike" | "code"
  | "superscript" | "subscript" | "textColor" | "backgroundColor"
  | "fontSize" | "fontFamily" | "link";

const commands: Readonly<Record<LegacyInlineToolId, SmartCommand<unknown>>> = Object.freeze({
  bold: toggleBold,
  italic: toggleItalic,
  underline: toggleUnderline,
  strike: toggleStrike,
  code: toggleInlineCode,
  superscript: toggleSuperscript,
  subscript: toggleSubscript,
  textColor: applyTextColor as SmartCommand<unknown>,
  backgroundColor: applyBackgroundColor as SmartCommand<unknown>,
  fontSize: applyFontSize as SmartCommand<unknown>,
  fontFamily: applyFontFamily as SmartCommand<unknown>,
  link: applyLink as SmartCommand<unknown>,
});

export const legacyInlineToolIds = Object.freeze(Object.keys(commands) as LegacyInlineToolId[]);

export interface LegacyInlineResult {
  readonly html: string;
  readonly selection: SmartEditorState["selection"];
}

export const runLegacyInlineTool = (
  root: HTMLElement,
  tool: LegacyInlineToolId,
  input?: unknown,
): LegacyInlineResult | null => {
  const selection = selectionFromDom(root, root.ownerDocument.getSelection());
  if (!selection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const state: SmartEditorState = { document, selection };
  const command = commands[tool];
  if (!command.isEnabled(state, input)) return null;
  const next = applyTransaction(state, command.execute(state, input));
  return { html: serializeSmartDocument(next.document), selection: next.selection };
};

export const runLegacyLinkAction = (
  root: HTMLElement,
  action: "apply" | "edit" | "remove",
  input?: { href: string; target?: string },
): LegacyInlineResult | null => {
  const selection = selectionFromDom(root, root.ownerDocument.getSelection());
  if (!selection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const state: SmartEditorState = { document, selection };
  const command = action === "remove" ? removeLink : action === "edit" ? updateLink : applyLink;
  if (!command.isEnabled(state, input as never)) return null;
  const next = applyTransaction(state, command.execute(state, input as never));
  return { html: serializeSmartDocument(next.document), selection: next.selection };
};
