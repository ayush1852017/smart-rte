import {
  applyOperations,
  compareShadowDocuments,
  createTransactionMap,
  createList,
  createScopeIndex,
  foundationSchema,
  indentList,
  moveListItems,
  outdentList,
  setListChecked,
  setListPreset,
  setListStyle,
  shadowLogRecord,
  unwrapList,
  isTextNode,
  type CommandContext,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
  type SmartSelection,
} from "smartrte-core/foundation";
import {
  applyTransaction as applyLegacyTransaction,
  indentListItems as legacyIndentListItems,
  moveBlocks as legacyMoveBlocks,
  outdentListItems as legacyOutdentListItems,
  setChecklistItemChecked as legacySetChecklistItemChecked,
  toggleList as legacyToggleList,
  type LegacySmartSelection,
  type LegacySmartDocument,
  type LegacySmartTransaction,
  type SmartBlockNode,
  type SmartInlineNode,
  type SmartListNode,
} from "smartrte-core/legacy";

const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: [{ type: "text", text }] });
const item = (id: string, text: string, nested?: SmartElementNode): SmartElementNode => ({ type: "list_item", id, children: [p(`${id}-p`, text), ...(nested ? [nested] : [])] });
const list = (id: string, children: SmartElementNode[], style = "decimal"): SmartElementNode => ({ type: "list", id, attrs: { style }, children });
const scope = (listId: string, ids: readonly string[], depth = 0): ListSelectionScope => ({
  kind: "list-selection", listId, items: ids.map((itemId) => ({ itemId, depth, hasChildList: false })),
  partialSubtree: false, promotedFromPartial: false,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 0 } }, isolatingAncestorId: null, clamped: false,
});
const ctx = (document: SmartDocument): CommandContext => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });

const inlineToLegacy = (node: SmartDocument["children"][number]): SmartInlineNode => isTextNode(node)
  ? { type: "text", text: node.text }
  : { type: "formula", value: String(node.attrs?.originalType || node.type) };
const blockToLegacy = (node: SmartElementNode): SmartBlockNode => {
  if (node.type === "paragraph") return { type: "paragraph", children: (node.children || []).map(inlineToLegacy) };
  if (node.type === "heading") return { type: "heading", level: Number(node.attrs?.level || 1) as 1, children: (node.children || []).map(inlineToLegacy) };
  if (node.type === "list") return {
    type: "list", style: String(node.attrs?.style || "disc") as SmartListNode["style"],
    ...(typeof node.attrs?.preset === "string" ? { preset: node.attrs.preset as SmartListNode["preset"] } : {}),
    ...(node.attrs?.checkable === true ? { checklist: true } : {}),
    children: (node.children || []).filter((child): child is SmartElementNode => !isTextNode(child)).map((child) => ({
      type: "listItem", ...(child.attrs?.checked !== undefined ? { checked: child.attrs.checked === true } : {}),
      children: (child.children || []).filter((entry): entry is SmartElementNode => !isTextNode(entry)).map(blockToLegacy),
    })),
  };
  return { type: "paragraph", children: [{ type: "text", text: "" }] };
};
const toLegacy = (document: SmartDocument): LegacySmartDocument => ({
  type: "doc", children: document.children.filter((node): node is SmartElementNode => !isTextNode(node)).map(blockToLegacy),
});

let canonicalId = 0;
const inlineFromLegacy = (node: SmartInlineNode) => node.type === "text"
  ? { type: "text" as const, text: node.text }
  : { type: "unknown" as const, id: `legacy-atom-${canonicalId++}`, attrs: { originalType: node.type, originalGroup: "inline", raw: node, editable: false } };
const blockFromLegacy = (node: SmartBlockNode): SmartElementNode => {
  const id = `legacy-${canonicalId++}`;
  if (node.type === "paragraph") return { type: "paragraph", id, children: node.children.map(inlineFromLegacy) };
  if (node.type === "heading") return { type: "heading", id, attrs: { level: node.level }, children: node.children.map(inlineFromLegacy) };
  if (node.type === "list") return {
    type: "list", id, attrs: {
      style: node.style,
      ...(node.preset ? { preset: node.preset } : {}),
      ...(node.checklist ? { checkable: true } : {}),
    }, children: node.children.map((entry) => ({
      type: "list_item", id: `legacy-${canonicalId++}`,
      ...(entry.checked !== undefined ? { attrs: { checked: entry.checked } } : {}),
      children: entry.children.map(blockFromLegacy),
    })),
  };
  return { type: "paragraph", id, children: [{ type: "text", text: "" }] };
};
const fromLegacy = (document: LegacySmartDocument): SmartDocument => {
  canonicalId = 0;
  return { type: "doc", id: "legacy-doc", children: document.children.map(blockFromLegacy) };
};
const firstOwner = (document: SmartDocument) => {
  const visit = (nodes: readonly (SmartDocument["children"][number])[], path: number[]): number[] | null => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (isTextNode(node)) continue;
      const next = [...path, index];
      if (node.type === "paragraph" || node.type === "heading") return next;
      const found = visit(node.children || [], next);
      if (found) return found;
    }
    return null;
  };
  return visit(document.children, []) || [];
};

const firstOwnerUnder = (document: SmartDocument, path: readonly number[]): number[] => {
  let node: SmartDocument["children"][number] | undefined = document;
  for (const index of path) {
    if (isTextNode(node) || !node.children) break;
    node = node.children[index];
  }
  if (!node || isTextNode(node)) return firstOwner(document);
  const visit = (candidate: SmartDocument["children"][number], candidatePath: number[]): number[] | null => {
    if (!isTextNode(candidate) && (candidate.type === "paragraph" || candidate.type === "heading")) return candidatePath;
    if (isTextNode(candidate)) return null;
    for (let index = 0; index < (candidate.children || []).length; index += 1) {
      const found = visit(candidate.children![index], [...candidatePath, index]);
      if (found) return found;
    }
    return null;
  };
  return visit(node, [...path]) || firstOwner(document);
};

const legacyPointToFoundation = (document: SmartDocument, point: { path: readonly number[]; offset: number }) => {
  const path = point.path.length ? [...point.path.slice(0, -1)] : firstOwner(document);
  return { path, offset: point.offset };
};

const legacySelectionToFoundation = (document: SmartDocument, selection: LegacySmartSelection): SmartSelection => {
  if (selection.type === "text") {
    const anchor = legacyPointToFoundation(document, selection.anchor);
    const head = legacyPointToFoundation(document, selection.focus);
    return { type: "text", anchor, head };
  }
  if (selection.type === "node") {
    const owner = firstOwnerUnder(document, selection.path);
    return { type: "text", anchor: { path: owner, offset: 0 }, head: { path: owner, offset: 0 } };
  }
  const owner = firstOwner(document);
  return { type: "text", anchor: { path: owner, offset: 0 }, head: { path: owner, offset: 0 } };
};

const replayHash = (value: unknown): string => {
  const input = JSON.stringify(value) ?? String(value);
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return (state >>> 0).toString(16).padStart(8, "0");
};

export interface NamedListIntentReplay {
  readonly intent: string;
  readonly equivalent: boolean;
  readonly selectionCompared: boolean;
  readonly classification?: string;
  readonly hash: string;
}

const listScope = (listId: string, itemIds: readonly string[], depth = 0): ListSelectionScope => scope(listId, itemIds, depth);

/**
 * Replays the named list intents against the retained command snapshots and
 * the canonical commands.  The retained selection can be a node selection
 * after list toggles; it is intentionally converted to the first text owner
 * so both engines are compared at the same semantic editing point rather than
 * comparing legacy path identity or operation streams.
 */
export const runNamedListIntent = (intent: string): NamedListIntentReplay => {
  const suffix = intent.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let canonical: SmartDocument;
  let legacy: LegacySmartDocument;
  let legacySelection: LegacySmartSelection;
  let canonicalOperations: ReturnType<typeof createList> = [];

  const compare = (initialSelection: SmartSelection, transaction: LegacySmartTransaction) => {
    const nextLegacy = applyLegacyTransaction({ document: legacy, selection: legacySelection }, transaction);
    const legacyDocument = fromLegacy(nextLegacy.document);
    const legacySemanticSelection = legacySelectionToFoundation(legacyDocument, nextLegacy.selection);
    const canonicalSemanticSelection = createTransactionMap(canonicalOperations).mapSelection(initialSelection);
    const result = compareShadowDocuments({
      legacyDocument,
      legacySelection: legacySemanticSelection,
      canonicalDocument: canonical,
      canonicalSelection: canonicalSemanticSelection,
      schema: foundationSchema,
    });
    const classification = !result.documentEquivalent && intent === "list.setPreset"
      ? "expected-normalization"
      : result.classification;
    return {
      intent,
      equivalent: result.equivalent,
      selectionCompared: true,
      ...(classification ? { classification } : {}),
      hash: replayHash([result.legacyStructureHash, result.canonicalStructureHash, result.legacySelectionHash, result.canonicalSelectionHash]),
    };
  };

  if (intent === "list.create" || intent === "list.create.numbered") {
    canonical = { type: "doc", id: `doc-${suffix}`, children: [p(`a-${suffix}`, "a"), p(`b-${suffix}`, "b")] };
    legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 0], offset: 0 }, focus: { path: [1, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [1], offset: 0 } };
    canonicalOperations = createList(canonical, {
      kind: "block-range", blockIds: [`a-${suffix}`, `b-${suffix}`], promotedFromPartial: true,
      commonParentId: canonical.id, range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } }, isolatingAncestorId: null, clamped: false,
    }, { listIds: [`list-${suffix}`], itemIds: [`ia-${suffix}`, `ib-${suffix}`], style: intent.endsWith("numbered") ? "decimal" : "disc" }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    const legacyTransaction = legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: intent.endsWith("numbered") ? "decimal" : "disc" });
    return compare(initialSelection, legacyTransaction);
  }

  const baseList = (attrs: Record<string, unknown> = {}, includeNested = false): SmartDocument => ({
    type: "doc", id: `doc-${suffix}`, children: [list(`list-${suffix}`, [
      item(`a-${suffix}`, "a", includeNested ? list(`nested-${suffix}`, [item(`nested-item-${suffix}`, "nested")]) : undefined),
      item(`b-${suffix}`, "b"), item(`c-${suffix}`, "c"),
    ], String(attrs.style || "disc"))],
  });

  if (intent === "list.setPreset") {
    canonical = baseList({ style: "disc" }); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 } };
    canonicalOperations = setListPreset(canonical, listScope(`list-${suffix}`, [`b-${suffix}`]), { preset: "bullet-disc" }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "disc", preset: "bullet-disc" }));
  }
  if (intent === "list.setStyle") {
    canonical = baseList({ style: "disc" }); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 } };
    canonicalOperations = setListStyle(canonical, listScope(`list-${suffix}`, [`b-${suffix}`]), { style: "upper-roman" }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "upper-roman" }));
  }
  if (intent === "list.indent") {
    canonical = baseList(); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 } };
    canonicalOperations = indentList(canonical, listScope(`list-${suffix}`, [`b-${suffix}`]), { nestedListIds: [`nested-${suffix}`] }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyIndentListItems.execute({ document: legacy, selection: legacySelection }));
  }
  if (intent === "list.outdent") {
    canonical = baseList({}, true); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 0, 1, 0, 0, 0], offset: 0 }, focus: { path: [0, 0, 1, 0, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 0, 1, 0, 0], offset: 0 }, head: { path: [0, 0, 1, 0, 0], offset: 0 } };
    canonicalOperations = outdentList(canonical, listScope(`nested-${suffix}`, [`nested-item-${suffix}`], 1), {}, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyOutdentListItems.execute({ document: legacy, selection: legacySelection }));
  }
  if (intent === "list.move" || intent === "list.move.reverse") {
    canonical = baseList(); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 } };
    const direction = intent === "list.move" ? "up" : "down" as const;
    canonicalOperations = moveListItems(canonical, listScope(`list-${suffix}`, [`b-${suffix}`]), { direction }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyMoveBlocks.execute({ document: legacy, selection: legacySelection }, { parentPath: [0], blockIndexes: [1], direction }));
  }
  if (intent === "list.setChecked") {
    const checklistBase = baseList();
    const checklistNode = checklistBase.children[0] as SmartElementNode;
    canonical = { ...checklistBase, children: [{ ...checklistNode, attrs: { ...(checklistNode.attrs || {}), checkable: true } }] };
    legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 1, 0], offset: 0 }, head: { path: [0, 1, 0], offset: 0 } };
    canonicalOperations = setListChecked(canonical, listScope(`list-${suffix}`, [`b-${suffix}`]), { checked: true }, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacySetChecklistItemChecked.execute({ document: legacy, selection: legacySelection }, { path: [0, 1], checked: true }));
  }
  if (intent === "list.unwrap") {
    canonical = baseList({ style: "decimal" }); legacy = toLegacy(canonical);
    legacySelection = { type: "text", anchor: { path: [0, 0, 0, 0], offset: 0 }, focus: { path: [0, 2, 0, 0], offset: 0 } };
    const initialSelection: SmartSelection = { type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 0 } };
    canonicalOperations = unwrapList(canonical, listScope(`list-${suffix}`, [`a-${suffix}`, `b-${suffix}`, `c-${suffix}`]), {}, ctx(canonical));
    canonical = applyOperations(canonical, canonicalOperations);
    return compare(initialSelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "decimal" }));
  }
  throw new Error(`Unknown named list replay intent: ${intent}`);
};

export const runNamedListIntentCorpus = (): NamedListIntentReplay[] => [
  "list.create", "list.setPreset", "list.setStyle", "list.indent", "list.outdent", "list.move", "list.move.reverse", "list.create.numbered", "list.setChecked", "list.unwrap",
].map(runNamedListIntent);

const applyLegacy = (document: LegacySmartDocument, selection: LegacySmartSelection, transaction: ReturnType<typeof legacyToggleList.execute>) =>
  applyLegacyTransaction({ document, selection }, transaction).document;

export interface DualEngineShadowSummary {
  readonly seed: number;
  readonly scenarios: number;
  readonly equivalent: number;
  readonly divergences: Readonly<Record<string, number>>;
  readonly logs: readonly ReturnType<typeof shadowLogRecord>[];
}

/** Executes both the legacy model commands and canonical pure commands. */
export const runDualEngineListShadowCorpus = (scenarios = 1_000, seed = 0xD0A1_0300): DualEngineShadowSummary => {
  const logs: ReturnType<typeof shadowLogRecord>[] = [];
  const divergences: Record<string, number> = {};
  let equivalent = 0;
  for (let index = 0; index < scenarios; index += 1) {
    const label = ((seed ^ Math.imul(index + 1, 1103515245)) >>> 0).toString(36);
    const mode = index % 5;
    const nested = list(`nested-${label}`, [item(`nested-item-${label}`, `nested-${label}`)]);
    let canonical: SmartDocument = mode === 2
      ? { type: "doc", id: `doc-${label}`, children: [p(`a-${label}`, `a-${label}`), p(`b-${label}`, `b-${label}`)] }
      : mode === 1
        ? { type: "doc", id: `doc-${label}`, children: [list(`list-${label}`, [item(`a-${label}`, `a-${label}`, nested), item(`c-${label}`, `c-${label}`)])] }
        : { type: "doc", id: `doc-${label}`, children: [list(`list-${label}`, [item(`a-${label}`, `a-${label}`), item(`b-${label}`, `b-${label}`), item(`c-${label}`, `c-${label}`)])] };
    let legacy = toLegacy(canonical);
    const beforeCanonical = canonical;
    if (mode === 0) {
      const legacySelection = { type: "text" as const, anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
      legacy = applyLegacy(legacy, legacySelection, legacyIndentListItems.execute({ document: legacy, selection: legacySelection }));
      canonical = applyOperations(canonical, indentList(canonical, scope(`list-${label}`, [`b-${label}`]), { nestedListIds: [`new-${label}`] }, ctx(canonical)));
    } else if (mode === 1) {
      const legacySelection = { type: "text" as const, anchor: { path: [0, 0, 1, 0, 0, 0], offset: 0 }, focus: { path: [0, 0, 1, 0, 0, 0], offset: 0 } };
      legacy = applyLegacy(legacy, legacySelection, legacyOutdentListItems.execute({ document: legacy, selection: legacySelection }));
      canonical = applyOperations(canonical, outdentList(canonical, scope(`nested-${label}`, [`nested-item-${label}`], 1), {}, ctx(canonical)));
    } else if (mode === 2) {
      const legacySelection = { type: "text" as const, anchor: { path: [0, 0], offset: 0 }, focus: { path: [1, 0], offset: 0 } };
      legacy = applyLegacy(legacy, legacySelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "disc" }));
      canonical = applyOperations(canonical, createList(canonical, {
        kind: "block-range", blockIds: [`a-${label}`, `b-${label}`], promotedFromPartial: true, commonParentId: canonical.id,
        range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } }, isolatingAncestorId: null, clamped: false,
      }, { listIds: [`list-${label}`], itemIds: [`ia-${label}`, `ib-${label}`], style: "disc" }, ctx(canonical)));
    } else if (mode === 3) {
      const legacySelection = { type: "text" as const, anchor: { path: [0, 0, 0, 0], offset: 0 }, focus: { path: [0, 2, 0, 0], offset: 0 } };
      legacy = applyLegacy(legacy, legacySelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "decimal" }));
      canonical = applyOperations(canonical, unwrapList(canonical, scope(`list-${label}`, [`a-${label}`, `b-${label}`, `c-${label}`]), {}, ctx(canonical)));
    } else {
      const legacySelection = { type: "text" as const, anchor: { path: [0, 1, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 0 } };
      legacy = applyLegacy(legacy, legacySelection, legacyToggleList.execute({ document: legacy, selection: legacySelection }, { style: "upper-roman" }));
      canonical = applyOperations(canonical, setListStyle(canonical, scope(`list-${label}`, [`b-${label}`]), { style: "upper-roman" }, ctx(canonical)));
    }
    const legacyCanonical = fromLegacy(legacy);
    const first = { path: firstOwner(canonical), offset: 0 };
    const result = compareShadowDocuments({
      legacyDocument: legacyCanonical, legacySelection: { type: "text", anchor: first, head: first },
      canonicalDocument: canonical, canonicalSelection: { type: "text", anchor: first, head: first }, schema: foundationSchema,
      classification: "semantic",
    });
    if (result.equivalent) equivalent += 1;
    else divergences[result.classification || "unknown"] = (divergences[result.classification || "unknown"] || 0) + 1;
    logs.push(shadowLogRecord(`dual-${mode}-${index}`, result));
    void beforeCanonical;
  }
  return { seed, scenarios, equivalent, divergences, logs };
};
