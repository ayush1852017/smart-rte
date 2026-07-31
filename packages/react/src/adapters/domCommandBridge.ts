import {
  createSmartEditor,
  type SmartRtePlugin,
  type SmartSelection,
} from "smartrte-core";
import { restoreSelectionToDom, selectionFromDom } from "./domSelectionBridge.js";
import {
  serializeSmartDocument,
  smartDocumentFromEditorRoot,
} from "./domSmartDocument.js";

export interface DomCommandResult {
  html: string;
  selection: SmartSelection;
}

/**
 * Executes one model command against the live editor boundary.
 *
 * The DOM is parsed once, the command runs entirely in core, and the resulting
 * document replaces the DOM once. History and change emission remain owned by
 * the React host until the complete editor runtime is migrated.
 */
export const executeDomCommand = <Input>(args: {
  root: HTMLElement;
  plugins: SmartRtePlugin[];
  commandId: string;
  input?: Input;
  selection?: Selection | null;
}): DomCommandResult | null => {
  // These nodes are not represented by SmartDocument yet. Falling back is
  // mandatory so a supported command can never erase unsupported content.
  if (args.root.querySelector("img,video,audio,iframe")) {
    return null;
  }
  const selection = selectionFromDom(
    args.root,
    args.selection === undefined
      ? args.root.ownerDocument.defaultView?.getSelection() || null
      : args.selection,
  );
  if (!selection) return null;
  const { document } = smartDocumentFromEditorRoot(args.root);
  const editor = createSmartEditor({
    state: { document, selection },
    plugins: args.plugins,
  });
  if (!editor.execute(args.commandId, args.input)) return null;

  const html = serializeSmartDocument(editor.state.document);
  args.root.innerHTML = html;
  restoreSelectionToDom(args.root, editor.state.selection);
  return { html, selection: editor.state.selection };
};
