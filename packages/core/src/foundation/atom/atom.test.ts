// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  FoundationEditor,
  applyOperations,
  atomDeclarations,
  completeAtomUpload,
  compositionSegmentAt,
  createScopeIndex,
  deleteAtom,
  foundationSchema,
  insertAtom,
  invertOperation,
  nodeSelectionForAtom,
  resizeAtom,
  renderDocumentNaively,
  runAtomUpload,
  sanitizeAtomSource,
  serializePersistedEditorDocument,
  tokenizeCompositionOwner,
  updateAtom,
  validateAtomMime,
  validate,
  type AtomicNodeScope,
  type SmartDocument,
} from "../index.js";

const emptyRange = { from: { path: [0], offset: 0 }, to: { path: [0], offset: 0 } };
const emptyScope = { kind: "empty", range: emptyRange, isolatingAncestorId: null, clamped: false } as const;
const paragraphDoc = (): SmartDocument => ({
  type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "ab" }] }],
});
const context = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
const atomicScope = (document: SmartDocument, id: string): AtomicNodeScope => {
  const range = context(document).positions.rangeOf(id)!;
  return { kind: "atomic-node", nodeId: id, inline: true, range, isolatingAncestorId: null, clamped: false };
};

describe("Phase 7 generic atom engine", () => {
  it("preserves exact documents through randomized atom operation inversion (1,000 cases, seed 0xA70B2027)", () => {
    let state = 0xA70B2027;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
    const image = atomDeclarations.find((entry) => entry.type === "image")!;

    for (let caseIndex = 0; caseIndex < 1_000; caseIndex += 1) {
      const before = paragraphDoc();
      let document = before;
      const operations = insertAtom(document, emptyScope, {
        declaration: image,
        nodeId: `image-${caseIndex}`,
        attrs: { src: `https://example.test/${caseIndex}.png`, alt: `Image ${caseIndex}`, status: "ready" },
        ownerId: "p",
        offset: random() < 0.5 ? 0 : 2,
      }, context(document));
      document = applyOperations(document, operations);

      const updates = updateAtom(document, atomicScope(document, `image-${caseIndex}`), {
        attrs: {
          width: 16 + Math.floor(random() * 2_000),
          height: 16 + Math.floor(random() * 2_000),
          alt: `Updated ${Math.floor(random() * 100)}`,
        },
      }, context(document));
      operations.push(...updates);
      document = applyOperations(document, updates);

      if (random() < 0.5) {
        const removals = deleteAtom(document, atomicScope(document, `image-${caseIndex}`), {}, context(document));
        operations.push(...removals);
        document = applyOperations(document, removals);
      }

      const restored = applyOperations(document, operations.toReversed().map(invertOperation));
      expect(restored).toEqual(before);
    }
  });

  it("adds a throwaway atom declaration with zero command code", () => {
    const declaration = { type: "mention", kind: "formula" as const, group: "inline" as const, validate: () => true };
    const doc = paragraphDoc();
    const operations = insertAtom(doc, emptyScope, { declaration, nodeId: "mention", attrs: { source: "@Ada" }, ownerId: "p", offset: 1 }, context(doc));
    expect(operations).toHaveLength(1);
    expect((operations[0] as { after: { children: unknown[] } }).after.children).toHaveLength(3);
  });

  it("inserts, selects, updates, resizes, and deletes inline atoms generically", () => {
    const doc = paragraphDoc();
    const image = atomDeclarations.find((entry) => entry.type === "image")!;
    const inserted = applyOperations(doc, insertAtom(doc, emptyScope, {
      declaration: image, nodeId: "img", attrs: { src: "https://example.test/a.png", alt: "A" }, ownerId: "p", offset: 1,
    }, context(doc)));
    expect(inserted.children[0]).toMatchObject({ children: [{ text: "a" }, { type: "image", id: "img" }, { text: "b" }] });
    expect(nodeSelectionForAtom("img", context(inserted).positions)?.type).toBe("node");
    const scope = atomicScope(inserted, "img");
    const updated = applyOperations(inserted, updateAtom(inserted, scope, { attrs: { alt: "updated" } }, context(inserted)));
    const resized = applyOperations(updated, resizeAtom(updated, atomicScope(updated, "img"), { width: 200, height: 50, preserveAspectRatio: true }, context(updated)));
    expect((resized.children[0] as { children: Array<{ attrs?: Record<string, unknown> }> }).children[1].attrs).toMatchObject({ alt: "updated", width: 200, height: 50 });
    const deleted = applyOperations(resized, deleteAtom(resized, atomicScope(resized, "img"), {}, context(resized)));
    expect(JSON.stringify(deleted)).not.toContain('"id":"img"');
  });

  it("treats upload completion as non-history state and drops stale completion", async () => {
    const editor = new FoundationEditor({ document: paragraphDoc(), selection: { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } } });
    const image = atomDeclarations.find((entry) => entry.type === "image")!;
    const operations = insertAtom(editor.document, emptyScope, {
      declaration: image, nodeId: "upload", attrs: { src: "blob:preview", alt: "Preview", status: "pending", uploadId: "u1" }, ownerId: "p", offset: 0,
    }, { schema: editor.schema, positions: editor.positions });
    editor.transact((transaction) => {
      transaction.operations.push(...operations);
      transaction.setSelection({ type: "text", anchor: { path: [0], offset: 1 }, head: { path: [0], offset: 1 } });
    }, { source: "drop", addToHistory: true });
    expect(await runAtomUpload(editor, "upload", async () => ({ src: "https://cdn.test/image.png" }))).toBe(true);
    expect(editor.history.undo).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(editor.positions.exists("upload")).toBe(false);
    expect(completeAtomUpload(editor, "upload", { src: "https://cdn.test/late.png" })).toBe(false);
    expect(editor.positions.exists("upload")).toBe(false);
  });

  it("preserves errors, forbids blob persistence, and coalesces resize gestures", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "block_image", id: "img", attrs: { src: "https://x.test/a.png", alt: "", decorative: true, status: "ready", width: 100, height: 50 } }] };
    const editor = new FoundationEditor({ document, selection: { type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 } } });
    completeAtomUpload(editor, "img", { error: "network" });
    expect(JSON.stringify(editor.document)).toContain("network");
    for (const [width, time] of [[120, 1], [140, 2]] as const) {
      const ops = resizeAtom(editor.document, atomicScope(editor.document, "img"), { width, height: 70 }, { schema: editor.schema, positions: editor.positions });
      editor.transact((transaction) => transaction.operations.push(...ops), { source: "api", historyGroup: "resize:img:1", timestamp: time, addToHistory: true });
    }
    expect(editor.history.undo).toHaveLength(1);
    const blob = { schemaVersion: 2, revision: 0, document: { ...document, children: [{ ...document.children[0], attrs: { src: "blob:dead", alt: "" } }] } };
    expect(() => serializePersistedEditorDocument(blob)).toThrow(/blob URL/);
    const pending = { schemaVersion: 2, revision: 0, document: { ...document, children: [{ ...document.children[0], attrs: { src: "https://preview.test/a.png", alt: "", status: "pending" } }] } };
    expect(() => serializePersistedEditorDocument(pending)).toThrow(/pending atom/);
  });

  it("tokenizes atoms as opaque units and terminates composition at either boundary", () => {
    const owner = { type: "paragraph", id: "p", children: [{ type: "text" as const, text: "a" }, { type: "formula", id: "f", attrs: { source: "x", notation: "latex" } }, { type: "text" as const, text: "b" }] };
    const tokens = tokenizeCompositionOwner(owner);
    expect(tokens.map((token) => token.kind)).toEqual(["text", "atom", "text"]);
    expect(compositionSegmentAt(tokens, 1)).toEqual({ from: 1, to: 1 });
    expect(compositionSegmentAt(tokens, 2)).toEqual({ from: 2, to: 2 });
  });
});

describe("Phase 7 security boundary", () => {
  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml,<svg onload=alert(1)>", "file:///etc/passwd", "https://safe.test/a.png\u0000.js",
  ])("rejects hostile resource URL %s", (value) => expect(sanitizeAtomSource(value, { kind: "image" })).toBeNull());

  it("allows only explicit raster image data and validates MIME allowlists", () => {
    expect(sanitizeAtomSource("data:image/png;base64,AA==", { kind: "image" })).toContain("data:image/png");
    expect(validateAtomMime("image", "image/png")).toBe(true);
    expect(validateAtomMime("image", "text/html")).toBe(false);
    expect(validateAtomMime("video", "video/mp4")).toBe(true);
    expect(validateAtomMime("video", "image/svg+xml")).toBe(false);
  });

  it("rejects hostile source changes at update and async-completion boundaries", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "block_image", id: "image", attrs: { src: "https://safe.test/a.png", alt: "A", status: "ready" } }] };
    const scope = atomicScope(document, "image");
    expect(updateAtom(document, scope, { attrs: { src: "javascript:alert(1)" } }, context(document))).toEqual([]);
    const editor = new FoundationEditor({ document, selection: { type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 } } });
    expect(completeAtomUpload(editor, "image", { src: "data:text/html,<script>alert(1)</script>" })).toBe(true);
    expect(JSON.stringify(editor.document)).not.toContain("data:text/html");
    expect(JSON.stringify(editor.document)).toContain('"status":"error"');
  });

  it("renders atoms read-only without inline SVG, evaluation, or user HTML", () => {
    const root = document.createElement("div");
    renderDocumentNaively(root, { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "formula", id: "f", attrs: { source: '<svg onload="alert(1)"><script>evil()</script></svg>', notation: "latex" } }] }] });
    const formula = root.querySelector<HTMLElement>('[data-smart-id="f"]')!;
    expect(formula.contentEditable).toBe("false");
    expect(formula.querySelector("svg,script,img,iframe")).toBeNull();
    expect(formula.textContent).toContain("<svg");
  });

  it("rejects malformed dimensions while preserving parse-error content", () => {
    const malformed: SmartDocument = { type: "doc", id: "doc", children: [{ type: "block_image", id: "bad", attrs: { src: "https://x.test/a.png", alt: "A", width: 1e9, status: "error", error: "decode failed" } }] };
    expect(validate(malformed).map((error) => error.code)).toContain("invalid-attribute");
    expect(JSON.stringify(malformed)).toContain("decode failed");
  });
});
