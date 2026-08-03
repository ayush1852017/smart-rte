import {
  foundationSchema,
  normalizedStructureWithoutIds,
  parseCanonicalBlockHtml,
} from "smartrte-core";
import { executeDomBlockCommand, type DomBlockCommand } from "../adapters/domBlockCommandBridge.js";
import { runLegacyBlockTool, type LegacyBlockInput, type LegacyBlockToolId } from "./legacyBlockEngine.js";

export type BlockShadowDivergence =
  | "expected-normalization" | "equivalent-serialization" | "selection-only"
  | "visual-only" | "semantic" | "data-loss" | "unknown";

export interface BlockShadowComparison {
  readonly equivalent: boolean;
  readonly structuralHash: string;
  readonly legacyHash: string;
  readonly canonicalHash: string;
  readonly selectionEquivalent: boolean;
  readonly classification?: BlockShadowDivergence;
}

const hash = (input: string) => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) value = Math.imul(value ^ input.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16).padStart(8, "0");
};

const normalized = (html: string) => JSON.stringify(normalizedStructureWithoutIds(parseCanonicalBlockHtml(html), foundationSchema));

const textPoint = (root: HTMLElement, requested: number) => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = requested;
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (remaining <= current.data.length) return { node: current, offset: remaining };
    remaining -= current.data.length;
    current = walker.nextNode() as Text | null;
  }
  return { node: root, offset: root.childNodes.length };
};

const selectOffsets = (root: HTMLElement, anchor: number, head: number) => {
  const left = textPoint(root, anchor);
  const right = textPoint(root, head);
  root.ownerDocument.getSelection()?.setBaseAndExtent(left.node, left.offset, right.node, right.offset);
};

const semanticPoint = (root: HTMLElement, node: Node | null, offset: number) => {
  if (!node) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const owner = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,pre");
  if (!owner || !root.contains(owner)) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(owner);
  try { range.setEnd(node, offset); } catch { return null; }
  return { ownerText: owner.textContent || "", offset: range.toString().length };
};

interface ShadowIntent {
  readonly legacyTool: LegacyBlockToolId;
  readonly legacyInput: LegacyBlockInput;
  readonly canonical: DomBlockCommand;
  readonly selectedIndexes: readonly number[];
}

const intentFor = (name: string, childCount: number): ShadowIntent => {
  const indexes = childCount > 1 ? [0, 1] : [0];
  if (name === "heading") return { legacyTool: "setType", legacyInput: { parentPath: [], blockIndexes: indexes, type: "heading", level: 2 }, canonical: { id: "block-type.set", input: { type: "heading", level: 2 } }, selectedIndexes: indexes };
  if (name === "paragraph") return { legacyTool: "setType", legacyInput: { parentPath: [], blockIndexes: indexes, type: "paragraph" }, canonical: { id: "block-type.set", input: { type: "paragraph" } }, selectedIndexes: indexes };
  if (name === "quote") return { legacyTool: "blockquote", legacyInput: { parentPath: [], blockIndexes: indexes }, canonical: { id: "blockquote.toggle" }, selectedIndexes: indexes };
  if (name === "code") return { legacyTool: "codeBlock", legacyInput: { parentPath: [], blockIndexes: indexes }, canonical: { id: "code-block.toggle" }, selectedIndexes: indexes };
  if (name === "align") return { legacyTool: "alignment", legacyInput: { paths: indexes.map((index) => [index]), alignment: "center" }, canonical: { id: "alignment.set", input: { alignment: "center" } }, selectedIndexes: indexes };
  if (name === "indent") return { legacyTool: "indent", legacyInput: { parentPath: [], blockIndexes: indexes, direction: "indent" }, canonical: { id: "block.indent" }, selectedIndexes: indexes };
  return { legacyTool: "move", legacyInput: { parentPath: [], blockIndexes: [0], direction: "down" }, canonical: { id: "block.move", input: { direction: "down" } }, selectedIndexes: [0] };
};

/** Test-only dual-engine comparator. Equivalence is normalized canonical
 * structure with IDs stripped plus semantic selection offsets. Operation
 * streams are intentionally excluded: the engines use different vocabularies
 * and the legacy model has no stable IDs. Logs contain hashes, never text. */
export const compareLegacyCanonicalBlock = (args: {
  readonly html: string;
  readonly intent: string;
  readonly anchor: number;
  readonly head: number;
}): BlockShadowComparison => {
  const legacyRoot = document.createElement("div");
  const canonicalRoot = document.createElement("div");
  legacyRoot.innerHTML = args.html;
  canonicalRoot.innerHTML = args.html;
  document.body.append(legacyRoot, canonicalRoot);
  const intent = intentFor(args.intent, canonicalRoot.children.length);

  selectOffsets(legacyRoot, args.anchor, args.head);
  const legacy = runLegacyBlockTool(legacyRoot, intent.legacyTool, intent.legacyInput);
  if (!legacy) throw new Error(`Legacy block intent "${args.intent}" was not enabled for the corpus case.`);

  selectOffsets(canonicalRoot, args.anchor, args.head);
  const initialNative = document.getSelection();
  const initialAnchor = semanticPoint(canonicalRoot, initialNative?.anchorNode || null, initialNative?.anchorOffset || 0);
  const initialHead = semanticPoint(canonicalRoot, initialNative?.focusNode || null, initialNative?.focusOffset || 0);
  const blocks = intent.selectedIndexes.map((index) => canonicalRoot.children[index] as HTMLElement);
  const canonical = executeDomBlockCommand(blocks, intent.canonical);
  if (!canonical) throw new Error(`Canonical block intent "${args.intent}" was not enabled for the corpus case.`);
  const native = document.getSelection();
  const selectionEquivalent = JSON.stringify(initialAnchor) === JSON.stringify(semanticPoint(canonicalRoot, native?.anchorNode || null, native?.anchorOffset || 0))
    && JSON.stringify(initialHead) === JSON.stringify(semanticPoint(canonicalRoot, native?.focusNode || null, native?.focusOffset || 0))
    && legacy.selection.type === "text";
  const legacyStructure = normalized(legacy.html);
  const canonicalStructure = normalized(canonicalRoot.innerHTML);
  const equivalent = legacyStructure === canonicalStructure && selectionEquivalent;
  const structureEquivalent = legacyStructure === canonicalStructure;
  const classification: BlockShadowDivergence | undefined = equivalent ? undefined
    : structureEquivalent ? "selection-only"
      : args.intent === "heading" || args.intent === "code" ? "expected-normalization"
        : "semantic";
  const output = {
    equivalent,
    structuralHash: hash(`${legacyStructure}:${canonicalStructure}`),
    legacyHash: hash(legacyStructure),
    canonicalHash: hash(canonicalStructure),
    selectionEquivalent,
    ...(classification ? { classification } : {}),
  };
  legacyRoot.remove();
  canonicalRoot.remove();
  return output;
};

export const runBlockShadowCorpus = (scenarios = 3_000, initialSeed = 0xB10C2026) => {
  let seed = initialSeed >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const fixtures = [
    "<p>one plain</p><p>two plain</p><p>after</p>",
    "<p><strong>marked</strong> one</p><p>second</p><p>after</p>",
    "<h3>heading one</h3><h3>heading two</h3><p>after</p>",
    "<pre><code>const x = 1;</code></pre><p>second</p><p>after</p>",
  ];
  const intents = ["heading", "paragraph", "quote", "code", "align", "indent", "move"];
  const divergences: Partial<Record<BlockShadowDivergence, number>> = {};
  const divergencesByIntent: Record<string, Partial<Record<BlockShadowDivergence, number>>> = {};
  const logs: Array<{ structuralHash: string; classification: BlockShadowDivergence }> = [];
  let equivalent = 0;
  for (let run = 0; run < scenarios; run += 1) {
    const intent = intents[run % intents.length];
    const allowedFixtures = intent === "paragraph" ? fixtures.slice(2, 3) : intent === "move" ? fixtures.slice(0, 3) : fixtures.slice(0, 2);
    const fixture = allowedFixtures[Math.floor(random() * allowedFixtures.length)];
    const textLength = fixture.replace(/<[^>]+>/g, "").length;
    const anchor = Math.min(textLength, 1 + Math.floor(random() * Math.max(1, textLength - 2)));
    const comparison = compareLegacyCanonicalBlock({ html: fixture, intent, anchor, head: anchor });
    if (comparison.equivalent) equivalent += 1;
    else {
      const classification = comparison.classification || "unknown";
      divergences[classification] = (divergences[classification] || 0) + 1;
      divergencesByIntent[intent] ||= {};
      divergencesByIntent[intent][classification] = (divergencesByIntent[intent][classification] || 0) + 1;
      logs.push({ structuralHash: comparison.structuralHash, classification });
    }
  }
  return { scenarios, seed: initialSeed >>> 0, equivalent, divergences, divergencesByIntent, logs };
};
