import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartElementNode } from "../types.js";
import { compareShadowDocuments, shadowLogRecord } from "./shadow.js";
import { parseCanonicalListHtml, serializeCanonicalListHtml } from "./formats.js";

export interface ShadowCorpusSummary {
  readonly seed: number;
  readonly scenarios: number;
  readonly equivalent: number;
  readonly divergences: Readonly<Record<string, number>>;
  readonly logs: readonly ReturnType<typeof shadowLogRecord>[];
}

/** Browser-neutral replay of the production legacy-HTML comparator boundary. */
export const runListShadowReplayCorpus = (scenarios = 1_000, seed = 0x51A0_0300): ShadowCorpusSummary => {
  const logs: ReturnType<typeof shadowLogRecord>[] = [];
  const divergences: Record<string, number> = {};
  let equivalent = 0;
  for (let index = 0; index < scenarios; index += 1) {
    const label = ((seed ^ Math.imul(index + 1, 2654435761)) >>> 0).toString(36);
    const nested: SmartElementNode = {
      type: "list", id: `nested-${label}`, attrs: { style: index % 2 ? "lower-alpha" : "circle" }, children: [{
        type: "list_item", id: `nested-item-${label}`, children: [{ type: "paragraph", id: `nested-p-${label}`, children: [{ type: "text", text: `nested-${label}` }] }],
      }],
    };
    const canonical: SmartDocument = { type: "doc", id: `doc-${label}`, children: [{
      type: "list", id: `list-${label}`, attrs: {
        style: index % 2 ? "decimal" : "disc",
        ...(index % 3 === 0 ? { checkable: true } : {}),
        ...(index % 5 === 0 ? { start: 3 } : {}),
      }, children: [0, 1, 2].map((itemIndex): SmartElementNode => ({
        type: "list_item", id: `item-${label}-${itemIndex}`,
        ...(index % 3 === 0 ? { attrs: { checked: itemIndex === 1 } } : {}),
        children: [{ type: itemIndex === 0 && index % 4 === 0 ? "heading" : "paragraph", id: `p-${label}-${itemIndex}`, ...(itemIndex === 0 && index % 4 === 0 ? { attrs: { level: 2 } } : {}), children: [{ type: "text", text: `content-${label}-${itemIndex}` }] }, ...(itemIndex === 1 ? [nested] : [])],
      })),
    }] };
    const legacy = parseCanonicalListHtml(serializeCanonicalListHtml(canonical, { clean: true }));
    const pos = { path: [0, 0, 0], offset: 0 };
    const result = compareShadowDocuments({
      legacyDocument: legacy, legacySelection: { type: "text", anchor: pos, head: pos },
      canonicalDocument: canonical, canonicalSelection: { type: "text", anchor: pos, head: pos },
      schema: foundationSchema,
    });
    if (result.equivalent) equivalent += 1;
    else divergences[result.classification || "unknown"] = (divergences[result.classification || "unknown"] || 0) + 1;
    logs.push(shadowLogRecord(`browser-${index}`, result));
  }
  return { seed, scenarios, equivalent, divergences, logs };
};
