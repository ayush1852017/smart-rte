import mammoth from "mammoth";
import { parseCanonicalListHtml } from "../../list/formats.js";
import type { SmartDocument } from "../../types.js";
import { restorePortableDocxAtoms } from "./portableAtoms.js";

/**
 * Fidelity: `semantic` for structure. Matches the established pattern for
 * plain HTML import (CanonicalAuthorityEditor's runImport) - mammoth already
 * produces clean semantic HTML, so no compatibility/normalize pass is
 * inserted here; parseCanonicalListHtml's own fallback ("unknown" node with
 * raw HTML) handles anything it doesn't recognize.
 */
export const importDocxDocumentWithMammoth = async (arrayBuffer: ArrayBuffer): Promise<SmartDocument> => {
  // Mammoth's browser entry reads `arrayBuffer`, while its Node entry reads
  // `buffer`. Supplying both keeps the adapter portable across bundlers/tests.
  const result = await mammoth.convertToHtml({ arrayBuffer, buffer: arrayBuffer } as Parameters<typeof mammoth.convertToHtml>[0]);
  const html = restorePortableDocxAtoms(result.value);
  return parseCanonicalListHtml(html);
};
