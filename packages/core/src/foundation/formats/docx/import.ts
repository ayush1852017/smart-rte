import JSZip from "jszip";
import mammoth from "mammoth";
import { parseCanonicalListHtml } from "../../list/formats.js";
import type { SmartDocument } from "../../types.js";
import { restorePortableDocxAtoms } from "./portableAtoms.js";
import { assertDocxXmlWithinDepthLimit } from "./nestingGuard.js";

/**
 * Fidelity: `semantic` for structure. Matches the established pattern for
 * plain HTML import (CanonicalAuthorityEditor's runImport) - mammoth already
 * produces clean semantic HTML, so no compatibility/normalize pass is
 * inserted here; parseCanonicalListHtml's own fallback ("unknown" node with
 * raw HTML) handles anything it doesn't recognize.
 */
export const importDocxDocumentWithMammoth = async (arrayBuffer: ArrayBuffer): Promise<SmartDocument> => {
  // Defense-in-depth against pathologically deep XML - see nestingGuard.ts's
  // own doc comment for why this exists alongside (not instead of) the real
  // fixes in mammoth's own patched code. Checked against document.xml
  // specifically: the primary, always-present part every .docx has, and the
  // one the disclosed attack targets. A package that fails to unzip or has
  // no document.xml is left for mammoth's own error handling below, not
  // rejected here - this guard only rejects on a confirmed-deep document.
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (documentXml) assertDocxXmlWithinDepthLimit(documentXml);
  } catch (error) {
    if (error instanceof Error && error.name === "DocxNestingTooDeepError") throw error;
    // Any other failure here (corrupt zip, etc.) is mammoth's to report.
  }

  // Mammoth's browser entry reads `arrayBuffer`, while its Node entry reads
  // `buffer`. Supplying both keeps the adapter portable across bundlers/tests.
  const result = await mammoth.convertToHtml({ arrayBuffer, buffer: arrayBuffer } as Parameters<typeof mammoth.convertToHtml>[0]);
  const html = restorePortableDocxAtoms(result.value);
  return parseCanonicalListHtml(html);
};
