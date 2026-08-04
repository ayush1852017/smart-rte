import {
  foundationSchema,
  normalizedStructureWithoutIds,
  parseCanonicalListHtml,
  parseClipboardPayload,
  type RawClipboardPayload,
  type SmartDocument,
} from "smartrte-core/foundation";
import { legacyCleanPastedHtml } from "./legacyClipboardEngine.js";

export type ClipboardDivergenceClassification =
  | "expected-normalization"
  | "equivalent-serialization"
  | "selection-only"
  | "visual-only"
  | "semantic"
  | "data-loss"
  | "unknown";

export interface ClipboardShadowResult {
  fixtureId: string;
  equivalent: boolean;
  classification: ClipboardDivergenceClassification | null;
  legacyHash: string;
  canonicalHash: string;
  canonicalTextConserved: boolean;
}

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
};
const text = (document: SmartDocument): string => JSON.stringify(document).match(/"text":"((?:\\.|[^"\\])*)"/g)?.map((entry) => {
  try { return String(JSON.parse(`{${entry}}`).text || ""); } catch { return ""; }
}).join(" ").replace(/\s+/g, " ").trim() || "";
const words = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const conserves = (document: SmartDocument, plainText: string) => {
  const expected = words(plainText);
  if (!expected.size) return true;
  const actual = words(text(document));
  let found = 0;
  expected.forEach((word) => { if (actual.has(word)) found += 1; });
  return found / expected.size >= 0.9;
};

/** Hash-only comparator log: no clipboard text or HTML leaves this function. */
export const compareClipboardFixture = (
  fixtureId: string,
  payload: RawClipboardPayload,
  ownerDocument: Document,
  approvedClassification?: ClipboardDivergenceClassification,
): ClipboardShadowResult => {
  const legacy = parseCanonicalListHtml(legacyCleanPastedHtml(payload.html || "", {}, ownerDocument));
  const canonical = parseClipboardPayload(payload, { ownerDocument }).document;
  const legacyStructure = JSON.stringify(normalizedStructureWithoutIds(legacy, foundationSchema));
  const canonicalStructure = JSON.stringify(normalizedStructureWithoutIds(canonical, foundationSchema));
  const equivalent = legacyStructure === canonicalStructure;
  const canonicalTextConserved = conserves(canonical, payload.plainText || "");
  const sameText = text(legacy) === text(canonical);
  return {
    fixtureId,
    equivalent,
    classification: equivalent ? null : !canonicalTextConserved ? "data-loss"
      : approvedClassification || (sameText ? "expected-normalization" : "semantic"),
    legacyHash: hash(legacyStructure),
    canonicalHash: hash(canonicalStructure),
    canonicalTextConserved,
  };
};
