import { useEffect, useRef } from "react";
import {
  createFoundationEditor,
  createInputPipeline,
  createSchema,
  createSubtreeRenderer,
  type CanonicalInputPipeline,
  type CanonicalSubtreeRenderer,
  type FoundationEditor,
  type SmartDocument,
  type SmartSchema,
} from "smartrte-core/foundation";
import { runDualEngineListShadowCorpus } from "../../src/adapters/legacyListShadowComparator.js";
import { runInlineShadowCorpus } from "../../src/test-harness/inlineShadowComparator.js";

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
    { type: "unknown", id: "inline-atom", attrs: { originalType: "formula", originalGroup: "inline", raw: { type: "formula" }, editable: false } },
    { type: "text", text: "b" },
  ],
}] });

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
    const editor = createFoundationEditor({
      document: isolation ? isolationDocument() : listTable ? listTableDocument() : checks ? checklistDocument() : atoms ? atomDocument() : lists ? listDocument() : createDocument(count),
      schema: isolation ? isolationSchema : listTable ? listTableSchema : undefined,
      selection: isolation
        ? { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [0], offset: 2 } }
        : atoms ? { type: "text", anchor: { path: [0], offset: 3 }, head: { path: [0], offset: 3 } }
        : listTable ? { type: "text", anchor: { path: [0, 0, 0, 0, 1, 0], offset: 0 }, head: { path: [0, 0, 0, 0, 1, 0], offset: 0 } }
        : checks ? { type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 0, 0], offset: 0 } }
        : lists ? { type: "text", anchor: { path: [0, 2, 0], offset: 0 }, head: { path: [0, 2, 0], offset: 0 } }
        : { type: "text", anchor: { path: [0], offset: 5 }, head: { path: [0], offset: 5 } },
    });
    const renderer = createSubtreeRenderer(root);
    const pipeline = createInputPipeline(editor, renderer, root);
    window.__smartCanonical = {
      editor, renderer, pipeline, lastInputPaintMs: null, blockCount: count,
      runShadowCorpus: (scenarios = 1_000) => runDualEngineListShadowCorpus(scenarios),
      runInlineShadowCorpus: (scenarios = 1_000) => runInlineShadowCorpus(scenarios),
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
