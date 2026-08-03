import { describe, expect, it } from "vitest";
import {
  applyOperations,
  compareShadowDocuments,
  continueListNumbering,
  createList,
  createScopeIndex,
  foundationSchema,
  indentList,
  outdentList,
  parseCanonicalListHtml,
  restartListNumbering,
  serializeCanonicalListHtml,
  setListChecked,
  setListPreset,
  setListStyle,
  shadowLogRecord,
  unwrapList,
  type CommandContext,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
  type SmartPos,
} from "../index.js";

const CASES = 3_000;
const SEED = 0x51A0_0300;
const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: [{ type: "text", text }] });
const item = (id: string, text: string, nested?: SmartElementNode): SmartElementNode => ({
  type: "list_item", id, children: [p(`${id}-p`, text), ...(nested ? [nested] : [])],
});
const list = (id: string, items: SmartElementNode[], attrs: Record<string, unknown> = { style: "decimal" }): SmartElementNode => ({
  type: "list", id, attrs, children: items,
});
const scope = (listId: string, itemIds: readonly string[], depth = 0): ListSelectionScope => ({
  kind: "list-selection", listId,
  items: itemIds.map((itemId) => ({ itemId, depth, hasChildList: false })),
  partialSubtree: false, promotedFromPartial: false,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 0 } },
  isolatingAncestorId: null, clamped: false,
});
const ctx = (document: SmartDocument): CommandContext => ({
  schema: foundationSchema,
  positions: createScopeIndex().positions(document, foundationSchema),
});
const firstInlinePos = (document: SmartDocument): SmartPos => {
  const visit = (nodes: readonly unknown[], path: number[]): SmartPos | null => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index] as { type?: string; children?: readonly unknown[] };
      const next = [...path, index];
      if ((node.type === "paragraph" || node.type === "heading")) return { path: next, offset: 0 };
      if (node.children) {
        const found = visit(node.children, next);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(document.children, []) || { path: [], offset: 0 };
};

const replay = (caseIndex: number): SmartDocument => {
  const label = `private-${(SEED ^ Math.imul(caseIndex + 1, 2654435761)) >>> 0}`;
  const nested = list(`nested-${caseIndex}`, [item(`n1-${caseIndex}`, `${label}-nested`)], { style: "lower-alpha" });
  let document: SmartDocument = {
    type: "doc", id: `doc-${caseIndex}`,
    children: [list(`list-${caseIndex}`, [
      item(`a-${caseIndex}`, `${label}-a`),
      item(`b-${caseIndex}`, `${label}-b`, caseIndex % 4 === 0 ? nested : undefined),
      item(`c-${caseIndex}`, `${label}-c`),
    ], { style: caseIndex % 2 ? "decimal" : "disc", ...(caseIndex % 5 === 0 ? { checkable: true } : {}) })],
  };
  const listId = `list-${caseIndex}`;
  const selected = scope(listId, [`b-${caseIndex}`]);
  const mode = caseIndex % 9;
  const operations = mode === 0
    ? indentList(document, selected, { nestedListIds: [`generated-${caseIndex}`] }, ctx(document))
    : mode === 1
      ? setListStyle(document, selected, { style: caseIndex % 2 ? "upper-roman" : "square" }, ctx(document))
      : mode === 2
        ? setListPreset(document, selected, { preset: caseIndex % 2 ? "ordered-upper-alpha" : "bullet-square" }, ctx(document))
        : mode === 3
          ? setListChecked(document, selected, { checked: true }, ctx(document))
          : mode === 4
            ? restartListNumbering(document, selected, { start: 2 + (caseIndex % 20) }, ctx(document))
            : mode === 5
              ? continueListNumbering(document, selected, {}, ctx(document))
              : mode === 6
                ? unwrapList(document, selected, { splitListIds: [`split-${caseIndex}`] }, ctx(document))
                : mode === 7 && caseIndex % 4 === 0
                  ? outdentList(document, scope(`nested-${caseIndex}`, [`n1-${caseIndex}`], 1), {}, ctx(document))
                  : createList(document, {
                    kind: "block-range", blockIds: [], promotedFromPartial: false, commonParentId: document.id,
                    range: { from: { path: [], offset: 0 }, to: { path: [], offset: 0 } }, isolatingAncestorId: null, clamped: false,
                  }, { listIds: [], itemIds: [], style: "disc" }, ctx(document));
  if (operations.length) document = applyOperations(document, operations);
  return document;
};

describe("Phase 3 generated shadow replay corpus", () => {
  it(`has no unexplained semantic/data-loss divergence in ${CASES} cases (seed 0x${SEED.toString(16)})`, () => {
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const canonical = replay(caseIndex);
      // The legacy branch is observed at its HTML boundary, then parsed into the
      // canonical comparison model exactly as the production comparator does.
      const legacy = parseCanonicalListHtml(serializeCanonicalListHtml(canonical, { clean: true }));
      const point = firstInlinePos(canonical);
      const selection = { type: "text" as const, anchor: point, head: point };
      const result = compareShadowDocuments({
        legacyDocument: legacy, legacySelection: selection,
        canonicalDocument: canonical, canonicalSelection: selection,
        schema: foundationSchema,
      });
      expect(result.documentEquivalent, `case ${caseIndex}`).toBe(true);
      expect(["semantic", "data-loss"]).not.toContain(result.classification);
      const log = JSON.stringify(shadowLogRecord(`generated-${caseIndex}`, result));
      expect(log).not.toContain("private-");
    }
  });
});
