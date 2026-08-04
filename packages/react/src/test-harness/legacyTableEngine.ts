import { createSmartEditor, tablePlugin } from "smartrte-core/legacy";
import { serializeSmartDocument, smartDocumentFromHtml } from "../adapters/domSmartDocument.js";

/**
 * Test-only snapshot of the pre-Phase-6 table engine entry point. Keep this
 * isolated from product imports so shadow comparison remains possible after
 * ClassicEditor switches to the foundation table commands.
 */
export interface LegacyTableIntent {
  readonly id: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export const executeRetainedLegacyTable = (
  html: string,
  intent: LegacyTableIntent,
  ownerDocument: Document = document,
): string | null => {
  const model = smartDocumentFromHtml(html, ownerDocument);
  if (model.children.length !== 1 || model.children[0].type !== "table") return null;
  const editor = createSmartEditor({
    state: { document: model, selection: { type: "node", path: [0] } },
    plugins: [tablePlugin],
  });
  if (!editor.execute(intent.id, { ...(intent.input || {}), tablePath: [0] })) return null;
  return serializeSmartDocument(editor.state.document);
};
