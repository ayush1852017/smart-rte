import { resolvePos } from "../positions.js";
import { repair } from "../schema.js";
import { isTextNode } from "../identity.js";
import type { SmartDocument, SmartNode, SmartSchema, SmartSelection } from "../types.js";

export type ShadowDivergenceClassification =
  | "expected-normalization"
  | "equivalent-serialization"
  | "selection-only"
  | "visual-only"
  | "semantic"
  | "data-loss"
  | "unknown";

export interface ShadowComparisonResult {
  readonly equivalent: boolean;
  readonly documentEquivalent: boolean;
  readonly selectionEquivalent: boolean;
  readonly legacyStructureHash: string;
  readonly canonicalStructureHash: string;
  readonly legacySelectionHash: string;
  readonly canonicalSelectionHash: string;
  readonly classification?: ShadowDivergenceClassification;
}

const sortedRecord = (value: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
};

/**
 * Comparator equivalence is normalized document structure with IDs stripped,
 * plus semantic selection position. Operation streams are intentionally not
 * compared: canonical editing is allowed to express the same user intent with
 * a different operation sequence, and the legacy engine has no stable IDs.
 */
export const normalizedStructureWithoutIds = (document: SmartDocument, schema: SmartSchema): unknown => {
  const repaired = repair(document, schema).doc;
  const strip = (node: SmartNode): unknown => isTextNode(node)
    ? { type: "text", text: node.text, ...(node.marks?.length ? { marks: node.marks.map((mark) => ({ type: mark.type, attrs: sortedRecord(mark.attrs) })) } : {}) }
    : {
      type: node.type,
      ...(node.attrs && Object.keys(node.attrs).length ? { attrs: sortedRecord(node.attrs) } : {}),
      ...(node.children ? { children: node.children.map(strip) } : {}),
    };
  return strip(repaired);
};

export const semanticSelectionPosition = (document: SmartDocument, selection: SmartSelection) => {
  const endpoint = (pos: SmartSelection["anchor"]) => {
    const resolved = resolvePos(document, pos);
    return { path: [...pos.path], offset: pos.offset, ownerType: resolved.parent.type, kind: resolved.kind };
  };
  return { type: selection.type, anchor: endpoint(selection.anchor), head: endpoint(selection.head) };
};

const hash = (value: unknown): string => {
  const input = JSON.stringify(value);
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return (state >>> 0).toString(16).padStart(8, "0");
};

export const compareShadowDocuments = (args: {
  legacyDocument: SmartDocument;
  legacySelection: SmartSelection;
  canonicalDocument: SmartDocument;
  canonicalSelection: SmartSelection;
  schema: SmartSchema;
  classification?: ShadowDivergenceClassification;
}): ShadowComparisonResult => {
  const legacyStructure = normalizedStructureWithoutIds(args.legacyDocument, args.schema);
  const canonicalStructure = normalizedStructureWithoutIds(args.canonicalDocument, args.schema);
  const legacySelection = semanticSelectionPosition(args.legacyDocument, args.legacySelection);
  const canonicalSelection = semanticSelectionPosition(args.canonicalDocument, args.canonicalSelection);
  const legacyStructureJson = JSON.stringify(legacyStructure);
  const canonicalStructureJson = JSON.stringify(canonicalStructure);
  const legacySelectionJson = JSON.stringify(legacySelection);
  const canonicalSelectionJson = JSON.stringify(canonicalSelection);
  const documentEquivalent = legacyStructureJson === canonicalStructureJson;
  const selectionEquivalent = legacySelectionJson === canonicalSelectionJson;
  return {
    equivalent: documentEquivalent && selectionEquivalent,
    documentEquivalent,
    selectionEquivalent,
    legacyStructureHash: hash(legacyStructure),
    canonicalStructureHash: hash(canonicalStructure),
    legacySelectionHash: hash(legacySelection),
    canonicalSelectionHash: hash(canonicalSelection),
    ...(!documentEquivalent || !selectionEquivalent ? { classification: args.classification || (documentEquivalent ? "selection-only" : "unknown") } : {}),
  };
};

/** Privacy-safe logger payload: hashes and classification, never document text. */
export const shadowLogRecord = (scenarioId: string, result: ShadowComparisonResult) => ({
  scenarioId,
  equivalent: result.equivalent,
  documentEquivalent: result.documentEquivalent,
  selectionEquivalent: result.selectionEquivalent,
  legacyStructureHash: result.legacyStructureHash,
  canonicalStructureHash: result.canonicalStructureHash,
  legacySelectionHash: result.legacySelectionHash,
  canonicalSelectionHash: result.canonicalSelectionHash,
  ...(result.classification ? { classification: result.classification } : {}),
});
