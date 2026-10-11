/**
 * Every exporter's output for captionlessDocument.ts. Run against
 * a 1.1.x source tree to (re)produce captionless-golden.json - the
 * byte-identical baseline imageCaptions.test.ts compares the current code
 * against (1.2 compatibility promise: documents without captions or
 * metadata export exactly as they did before). Not a test of its own.
 */
import { serializeCanonicalListHtml, serializeCanonicalListMarkdown } from "../../list/formats.js";
import { serializeClipboardRepresentations } from "../../clipboard/serialization.js";
import { smartDocumentToDocxXml } from "../../formats/docx/export.js";
import type { SmartDocument } from "../../types.js";

import { captionlessDocumentFixture } from "./captionlessDocument.js";

export const captionlessDocument = (): SmartDocument => structuredClone(captionlessDocumentFixture);

export const captionlessOutputs = (document: SmartDocument = captionlessDocument()): Record<string, string> => {
  const clipboard = serializeClipboardRepresentations(document);
  return {
    htmlClean: serializeCanonicalListHtml(document, { clean: true }),
    htmlFragment: serializeCanonicalListHtml(document, { fragment: true }),
    htmlFull: serializeCanonicalListHtml(document),
    markdown: serializeCanonicalListMarkdown(document),
    clipboardHtml: clipboard["text/html"] ?? "",
    clipboardPlain: clipboard["text/plain"] ?? "",
    docxDocumentXml: smartDocumentToDocxXml(document),
  };
};
