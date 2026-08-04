import {
  createSmartEditor,
  formulaPlugin,
  mediaPlugin,
} from "smartrte-core/legacy";
import { serializeSmartDocument, smartDocumentFromHtml } from "../adapters/domSmartDocument.js";

/**
 * Test-only snapshot of the pre-Phase-7 media/formula command entry point.
 * This file must remain isolated from product imports and was committed before
 * canonical atom routing or deletion so shadow evidence remains reproducible.
 */
export interface LegacyAtomIntent {
  readonly id: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export const executeRetainedLegacyAtom = (
  html: string,
  intent: LegacyAtomIntent,
  ownerDocument: Document = document,
): string | null => {
  const model = smartDocumentFromHtml(html, ownerDocument);
  const editor = createSmartEditor({
    state: {
      document: model,
      selection: { type: "text", anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 0 } },
    },
    plugins: [mediaPlugin, formulaPlugin],
  });
  if (!editor.execute(intent.id, intent.input)) return null;
  return serializeSmartDocument(editor.state.document);
};

