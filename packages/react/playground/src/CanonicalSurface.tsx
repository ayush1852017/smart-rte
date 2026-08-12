import { useEffect, useRef } from "react";
import {
  createFoundationEditor,
  createInputPipeline,
  completeAtomUpload,
  createSchema,
  atomDeclarations,
  insertAtom,
  createSubtreeRenderer,
  type CanonicalInputPipeline,
  type CanonicalSubtreeRenderer,
  type FoundationEditor,
  type SmartDocument,
  type RawClipboardPayload,
  type SmartSchema,
} from "smartrte-core/foundation";
import { runDualEngineListShadowCorpus } from "../../src/adapters/legacyListShadowComparator.js";
import { runInlineShadowCorpus } from "../../src/test-harness/inlineShadowComparator.js";
import { runAtomShadowCorpus } from "../../src/test-harness/atomShadowComparator.js";
import { compareClipboardFixture } from "../../src/test-harness/clipboardShadowComparator.js";

declare global {
  interface Window {
    __smartCanonical?: {
      editor: FoundationEditor;
      pipeline: CanonicalInputPipeline;
      renderer: CanonicalSubtreeRenderer;
      lastInputPaintMs: number | null;
      blockCount: number;
      runShadowCorpus: (scenarios?: number) => ReturnType<typeof runDualEngineListShadowCorpus>;
      runInlineShadowCorpus: (scenarios?: number) => ReturnType<typeof runInlineShadowCorpus>;
      runAtomShadowCorpus: (scenarios?: number) => ReturnType<typeof runAtomShadowCorpus>;
      compareClipboardFixture: (fixtureId: string, payload: RawClipboardPayload) => ReturnType<typeof compareClipboardFixture>;
      runAtomLifecycle: () => { completed: boolean; removedByUndo: boolean; staleDropped: boolean; historyDepth: number };
    };
  }
}

const blockCount = () => {
  const requested = Number(new URLSearchParams(window.location.search).get("blocks") || 3);
  return Number.isFinite(requested) ? Math.max(1, Math.min(10_000, Math.floor(requested))) : 3;
};

const createDocument = (count: number): SmartDocument => ({
  type: "doc",
  id: "canonical-doc",
  children: Array.from({ length: count }, (_, index) => ({
    type: "paragraph",
    id: `canonical-p-${index}`,
    children: [{ type: "text", text: index === 0 ? "start" : `block ${index}` }],
  })),
});

const isolationSchema: SmartSchema = createSchema({
  version: 25,
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "paragraph", group: "block", content: "inline*" },
    { type: "text", group: "inline" },
    { type: "grid", semanticRole: "table", group: "block", content: "grid_row+", isolating: true },
    { type: "grid_row", semanticRole: "table-row", group: "block", content: "grid_cell+" },
    { type: "grid_cell", semanticRole: "table-cell", group: "block", content: "block+", isolating: true },
  ],
});

const listTableSchema: SmartSchema = createSchema({
  version: 31,
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "paragraph", group: "block", content: "inline*" },
    { type: "text", group: "inline" },
    { type: "list", semanticRole: "list", group: "block", content: "list_item+", attributes: { style: {}, checkable: { default: false } } },
    { type: "list_item", semanticRole: "list-item", group: "block", content: "block+", attributes: { checked: { default: false } } },
    { type: "grid", semanticRole: "table", group: "block", content: "grid_row+", isolating: true },
    { type: "grid_row", semanticRole: "table-row", group: "block", content: "grid_cell+" },
    { type: "grid_cell", semanticRole: "table-cell", group: "block", content: "block+", isolating: true },
  ],
});

const isolationDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [
  paragraphNode("before", "before"),
  { type: "grid", id: "test-table", children: [{ type: "grid_row", id: "test-row", children: [
    { type: "grid_cell", id: "test-cell", children: [paragraphNode("inside", "inside")] },
  ] }] },
  paragraphNode("after", "after"),
] });

const atomDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [{
  type: "paragraph", id: "atom-owner", children: [
    { type: "text", text: "a" },
    { type: "formula", id: "inline-atom", attrs: { source: "x", notation: "latex" } },
    { type: "text", text: "b" },
  ],
}, { type: "block_image", id: "block-atom", attrs: { src: "https://example.test/image.png", alt: "Example image", status: "ready", width: 160, height: 90 } }, paragraphNode("after-atom", "after")] });

const listDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [{
  type: "list", id: "canonical-list", attrs: { preset: "bullet-disc", style: "disc" }, children: [
    { type: "list_item", id: "canonical-item-a", children: [paragraphNode("canonical-item-a-p", "alpha")] },
    { type: "list_item", id: "canonical-item-b", children: [paragraphNode("canonical-item-b-p", "beta"), {
      type: "list", id: "canonical-nested-list", attrs: { style: "circle" }, children: [
        { type: "list_item", id: "canonical-nested-item", children: [paragraphNode("canonical-nested-p", "nested")] },
      ],
    }] },
    { type: "list_item", id: "canonical-item-c", children: [paragraphNode("canonical-item-c-p", "gamma")] },
  ],
}] });

const listTableDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [{
  type: "grid", id: "list-table", children: [{ type: "grid_row", id: "list-row", children: [{
    type: "grid_cell", id: "list-cell", children: [{
      type: "list", id: "cell-list", attrs: { style: "disc" }, children: [
        { type: "list_item", id: "cell-item-a", children: [paragraphNode("cell-item-a-p", "a")] },
        { type: "list_item", id: "cell-item-b", children: [paragraphNode("cell-item-b-p", "b")] },
      ],
    }],
  }] }],
}] });

const checklistDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [{
  type: "list", id: "check-list", attrs: { style: "disc", checkable: true }, children: [
    { type: "list_item", id: "check-item", attrs: { checked: false }, children: [paragraphNode("check-item-p", "task")] },
  ],
}] });

const blockSemanticsDocument = (): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [
  { type: "heading", id: "semantic-heading-1", attrs: { level: 1 }, children: [{ type: "text", text: "Document title" }] },
  { type: "heading", id: "semantic-heading-2", attrs: { level: 2 }, children: [{ type: "text", text: "Section title" }] },
  { type: "blockquote", id: "semantic-quote", children: [paragraphNode("semantic-quote-p", "Quoted text")] },
  { type: "code_block", id: "semantic-code", attrs: { language: "typescript" }, children: [{ type: "text", text: "const value = 1;" }] },
] });

const tableDocument = (size: number): SmartDocument => ({ type: "doc", id: "canonical-doc", children: [{
  type: "table", id: "benchmark-table", attrs: { columnWidths: Array(size).fill(80), layout: "fixed" },
  children: Array.from({ length: size }, (_, row) => ({
    type: "table_row", id: `benchmark-row-${row}`, children: Array.from({ length: size }, (_, column) => ({
      type: "table_cell", id: `benchmark-cell-${row}-${column}`, attrs: { rowspan: 1, colspan: 1, header: row === 0 },
      children: [paragraphNode(`benchmark-p-${row}-${column}`, row === 0 ? `H${column}` : `${row}:${column}`)],
    })),
  })),
}] });

function paragraphNode(id: string, text: string) {
  return { type: "paragraph", id, children: [{ type: "text" as const, text }] };
}

export default function CanonicalSurface() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const count = blockCount();
    const params = new URLSearchParams(window.location.search);
    const isolation = params.has("isolation");
    const atoms = params.has("atoms");
    const lists = params.has("lists");
    const listTable = params.has("listTable");
    const checks = params.has("checks");
    const blockSemantics = params.has("blockSemantics");
    const requestedTable = Number(params.get("table") || 0);
    const tableSize = Number.isFinite(requestedTable) ? Math.max(0, Math.min(50, Math.floor(requestedTable))) : 0;
    const editor = createFoundationEditor({
      document: tableSize ? tableDocument(tableSize) : isolation ? isolationDocument() : listTable ? listTableDocument() : checks ? checklistDocument() : blockSemantics ? blockSemanticsDocument() : atoms ? atomDocument() : lists ? listDocument() : createDocument(count),
      schema: isolation ? isolationSchema : listTable ? listTableSchema : undefined,
      selection: tableSize ? { type: "text", anchor: { path: [0, 1, 0, 0], offset: 3 }, head: { path: [0, 1, 0, 0], offset: 3 } }
        : isolation
        ? { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [0], offset: 2 } }
        : atoms ? { type: "text", anchor: { path: [0], offset: 3 }, head: { path: [0], offset: 3 } }
        : listTable ? { type: "text", anchor: { path: [0, 0, 0, 0, 1, 0], offset: 0 }, head: { path: [0, 0, 0, 0, 1, 0], offset: 0 } }
        : checks ? { type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 0, 0], offset: 0 } }
        : blockSemantics ? { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } }
        : lists ? { type: "text", anchor: { path: [0, 2, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 0 } }
        : { type: "text", anchor: { path: [0], offset: 5 }, head: { path: [0], offset: 5 } },
    });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    window.__smartCanonical = {
      editor, renderer, pipeline, lastInputPaintMs: null, blockCount: count,
      runShadowCorpus: (scenarios = 1_000) => runDualEngineListShadowCorpus(scenarios),
      runInlineShadowCorpus: (scenarios = 1_000) => runInlineShadowCorpus(scenarios),
      runAtomShadowCorpus: (scenarios = 700) => runAtomShadowCorpus(scenarios),
      compareClipboardFixture: (fixtureId, payload) => compareClipboardFixture(
        fixtureId,
        payload,
        document,
        "expected-normalization",
      ),
      runAtomLifecycle: () => {
        const declaration = atomDeclarations.find((entry) => entry.type === "image")!;
        const scope = { kind: "empty", range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: 0 } }, isolatingAncestorId: null, clamped: false } as const;
        const operations = insertAtom(editor.document, scope, {
          declaration, nodeId: "browser-upload", ownerId: "atom-owner", offset: 0,
          attrs: { src: "blob:browser-preview", alt: "Upload preview", status: "pending", uploadId: "browser-upload" },
        }, { schema: editor.schema, positions: editor.positions });
        editor.transact((transaction) => transaction.operations.push(...operations), { source: "drop", addToHistory: true });
        const completed = completeAtomUpload(editor, "browser-upload", { src: "https://cdn.test/browser.png" });
        const historyDepth = editor.history.undo.length;
        editor.undo();
        const removedByUndo = !editor.positions.exists("browser-upload");
        const staleDropped = completeAtomUpload(editor, "browser-upload", { src: "https://cdn.test/late.png" }) === false;
        return { completed, removedByUndo, staleDropped, historyDepth };
      },
    };
    const measurePaint = () => {
      const started = performance.now();
      requestAnimationFrame(() => setTimeout(() => {
        if (window.__smartCanonical?.editor === editor) window.__smartCanonical.lastInputPaintMs = performance.now() - started;
      }, 0));
    };
    root.addEventListener("beforeinput", measurePaint, { capture: true });
    root.focus();
    return () => {
      root.removeEventListener("beforeinput", measurePaint, { capture: true });
      pipeline.destroy();
      renderer.destroy();
      root.replaceChildren();
      if (window.__smartCanonical?.editor === editor) delete window.__smartCanonical;
    };
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div
        ref={rootRef}
        aria-label="Canonical Smart RTE editing surface"
        role="textbox"
        aria-multiline="true"
        spellCheck={false}
        style={{
          border: "1px solid #aaa",
          minHeight: 180,
          padding: 12,
          whiteSpace: "pre-wrap",
          outline: "none",
          contentVisibility: "auto",
          containIntrinsicSize: "800px",
        }}
      />
    </main>
  );
}
