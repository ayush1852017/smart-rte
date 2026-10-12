import { describe, expect, it } from "vitest";
import { createFoundationEditor } from "../editor.js";
import { applyOperations } from "../operations.js";
import { RebaseConflictError } from "../transactions.js";
import { createNodeId, isTextNode } from "../identity.js";
import { parseCanonicalListHtml, serializeCanonicalListHtml } from "../list/formats.js";
import { foundationSchema, validate } from "../schema.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartSelection } from "../types.js";
import { blockDropTargets, isMovableBlockMedia, planBlockMove } from "./move.js";

const schema = foundationSchema;
const text = (value: string) => ({ type: "text" as const, text: value });
const p = (id: string, value: string): SmartElementNode => ({ type: "paragraph", id, children: [text(value)] });
const img = (id: string, extra: Record<string, unknown> = {}): SmartElementNode =>
  ({ type: "block_image", id, attrs: { src: `https://x.test/${id}.png`, alt: id, status: "ready", ...extra } });
const cell = (id: string, children: SmartElementNode[]): SmartElementNode => ({ type: "table_cell", id, attrs: { rowspan: 1, colspan: 1, header: false }, children });
const caret: SmartSelection = { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } };
const ids = (nodes: readonly SmartNode[] | undefined) => (nodes || []).map((node) => isTextNode(node) ? "#text" : node.id);
const slots = (document: SmartDocument, moving: string) => blockDropTargets(document, schema, moving).map((target) => `${target.parentId}:${target.index}`);

const tableDoc = (): SmartDocument => ({ type: "doc", id: "d", children: [
  p("a", "A"),
  img("img", { caption: "Cap", width: 120, height: 80, align: "left", metadata: { "data-source": "kadal" } }),
  p("b", "B"),
  { type: "table", id: "t", children: [{ type: "table_row", id: "r", children: [cell("c1", [p("x", "X")]), cell("c2", [p("y", "Y")])] }] },
  p("c", "C"),
] });

describe("blockDropTargets", () => {
  it("lists root and table-cell slots in visual order, skipping the node's own slot and the one after it", () => {
    expect(slots(tableDoc(), "img")).toEqual([
      "d:0", // before A
      // d:1 (own slot) and d:2 (right after itself) are no-ops
      "d:3", "c1:0", "c1:1", "c2:0", "c2:1",
      "d:4", "d:5",
    ]);
    const first = blockDropTargets(tableDoc(), schema, "img")[0];
    expect(first).toEqual({ parentId: "d", index: 0, parentPath: [], depth: 0, beforeNodeId: "a" });
    const inCell = blockDropTargets(tableDoc(), schema, "img").find((target) => target.parentId === "c2" && target.index === 1)!;
    expect(inCell).toMatchObject({ parentPath: [3, 0, 1], depth: 3, afterNodeId: "y" });
    expect(inCell).not.toHaveProperty("beforeNodeId");
  });

  it("includes list items and blockquotes (the schema allows blocks there) but never paragraphs, code blocks or atoms", () => {
    const document = parseCanonicalListHtml('<p>A</p><img src="https://x.test/i.png" alt="I"><ul><li><p>Item</p></li></ul><blockquote><p>Quote</p></blockquote><pre><code>code</code></pre><hr>');
    const image = document.children.find((node) => !isTextNode(node) && node.type === "block_image") as SmartElementNode;
    const targets = blockDropTargets(document, schema, image.id);
    const parentTypes = new Set(targets.map((target) => {
      const find = (node: SmartNode): string | null => isTextNode(node) ? null : node.id === target.parentId ? node.type : (node.children || []).map(find).find(Boolean) ?? null;
      return find(document);
    }));
    expect(parentTypes).toEqual(new Set(["doc", "list_item", "blockquote"]));
  });

  it("works for every block media type and nothing else", () => {
    const media: SmartElementNode[] = [
      img("bi"),
      { type: "block_formula", id: "bf", attrs: { latex: "E=mc^2" } },
      { type: "video", id: "v", attrs: { src: "https://x.test/v.mp4", status: "ready" } },
      { type: "audio", id: "au", attrs: { src: "https://x.test/a.mp3", status: "ready" } },
      { type: "divider", id: "hr", attrs: {} },
      { type: "page_break", id: "pb", attrs: {} },
    ];
    for (const node of media) {
      const document: SmartDocument = { type: "doc", id: "d", children: [p("a", "A"), node, p("b", "B"), { type: "blockquote", id: "q", children: [p("q1", "Q")] }] };
      expect(isMovableBlockMedia(node, schema), node.type).toBe(true);
      expect(slots(document, node.id), node.type).toEqual(["d:0", "d:3", "q:0", "q:1", "d:4"]);
    }
    const document = tableDoc();
    expect(slots(document, "a")).toEqual([]); // a paragraph isn't media
    expect(slots(document, "missing")).toEqual([]);
    expect(isMovableBlockMedia({ type: "image", id: "inline", attrs: { src: "https://x.test/i.png", alt: "", status: "ready" } }, schema)).toBe(false);
  });
});

describe("planBlockMove", () => {
  const editorWith = (document: SmartDocument) => createFoundationEditor({ document, selection: caret });
  const move = (editor: ReturnType<typeof editorWith>, moving: string, target: { parentId: string; index: number }) => {
    const operations = planBlockMove(editor.document, editor.schema, moving, target, { idFactory: createNodeId });
    expect(operations, `${moving} -> ${target.parentId}:${target.index}`).not.toBeNull();
    editor.transact((builder) => { builder.operations.push(...operations!); return builder.selectionAfter; }, { source: "api", addToHistory: true });
  };
  const known = (editor: ReturnType<typeof editorWith>, keep = ["a", "b", "c", "img", "t"]) => ids(editor.document.children).filter((id) => keep.includes(id));

  it("is one moveNode that keeps the node (id, caption, metadata, size) and one undo step", () => {
    const editor = editorWith(tableDoc());
    const before = structuredClone(editor.document);
    const imageBefore = structuredClone(editor.document.children[1]);
    const operations = planBlockMove(editor.document, schema, "img", { parentId: "d", index: 4 }, { idFactory: createNodeId })!;
    expect(operations).toEqual([{ type: "moveNode", nodeId: "img", from: { path: [], offset: 1 }, to: { path: [], offset: 3 } }]);
    move(editor, "img", { parentId: "d", index: 4 });
    expect(known(editor)).toEqual(["a", "b", "t", "img", "c"]);
    expect(editor.document.children.find((node) => !isTextNode(node) && node.id === "img")).toEqual(imageBefore);
    expect(editor.undo()).toBe(true);
    expect(editor.document).toEqual(before);
    expect(editor.redo()).toBe(true);
    expect(known(editor)).toEqual(["a", "b", "t", "img", "c"]);
  });

  it("moves up, into a table cell and back out; an emptied container gets an empty paragraph", () => {
    const editor = editorWith(tableDoc());
    move(editor, "img", { parentId: "d", index: 0 });
    expect(known(editor)).toEqual(["img", "a", "b", "t", "c"]);
    // Into the second cell, after "Y". The table now sits at a different root index than the target was computed in - that's the plan's job.
    move(editor, "img", { parentId: "c2", index: 1 });
    const table = () => editor.document.children.find((node) => !isTextNode(node) && node.id === "t") as SmartElementNode;
    const cellNode = (id: string) => ((table().children![0] as SmartElementNode).children as SmartElementNode[]).find((node) => node.id === id)!;
    expect(ids(cellNode("c2").children).filter((id) => id === "y" || id === "img")).toEqual(["y", "img"]);
    expect(known(editor)).toEqual(["a", "b", "t", "c"]);
    // Out of a cell where it's the only block (possible in stored documents;
    // the live editor's boundary normaliser usually pads it): the cell
    // gets an empty paragraph so it stays valid and editable.
    const lone: SmartDocument = { type: "doc", id: "d", children: [p("a", "A"), { type: "table", id: "t", children: [{ type: "table_row", id: "r", children: [cell("c1", [img("img")])] }] }, p("c", "C")] };
    const operations = planBlockMove(lone, schema, "img", { parentId: "d", index: 3 }, { idFactory: () => "filler" })!;
    expect(operations).toEqual([
      { type: "moveNode", nodeId: "img", from: { path: [1, 0, 0], offset: 0 }, to: { path: [], offset: 3 } },
      { type: "insertNode", pos: { path: [1, 0, 0], offset: 0 }, node: { type: "paragraph", id: "filler", children: [] } },
    ]);
    const after = applyOperations(lone, operations);
    expect(validate(after, schema)).toEqual([]);
    expect(ids(after.children)).toEqual(["a", "t", "c", "img"]);
  });

  it("refuses no-op and disallowed targets", () => {
    const document = tableDoc();
    expect(planBlockMove(document, schema, "img", { parentId: "d", index: 1 }, { idFactory: createNodeId })).toBeNull();
    expect(planBlockMove(document, schema, "img", { parentId: "d", index: 2 }, { idFactory: createNodeId })).toBeNull();
    expect(planBlockMove(document, schema, "img", { parentId: "a", index: 0 }, { idFactory: createNodeId })).toBeNull();
    expect(planBlockMove(document, schema, "img", { parentId: "r", index: 0 }, { idFactory: createNodeId })).toBeNull();
    expect(planBlockMove(document, schema, "img", { parentId: "d", index: 99 }, { idFactory: createNodeId })).toBeNull();
    expect(planBlockMove(document, schema, "b", { parentId: "d", index: 0 }, { idFactory: createNodeId })).toBeNull();
  });

  it("exports the same HTML as a document authored in the moved order", () => {
    const html = (body: string) => body.replace(/IMG/g, '<figure><img src="https://x.test/i.png" alt="I" width="120" height="80"><figcaption>Cap</figcaption></figure>');
    const editor = editorWith(parseCanonicalListHtml(html("<p>One</p>IMG<p>Two</p><p>Three</p>")));
    const image = editor.document.children.find((node) => !isTextNode(node) && node.type === "block_image") as SmartElementNode;
    move(editor, image.id, { parentId: editor.document.id, index: 3 });
    const expected = parseCanonicalListHtml(html("<p>One</p><p>Two</p>IMG<p>Three</p>"));
    expect(serializeCanonicalListHtml(editor.document, { clean: true })).toBe(serializeCanonicalListHtml(expected, { clean: true }));
  });
});

describe("planBlockMove under collaboration", () => {
  const base = (): SmartDocument => ({ type: "doc", id: "d", children: [p("a", "Alpha"), img("img", { caption: "Cap" }), p("b", "Beta"), p("c", "Gamma"), p("e", "Delta")] });
  const snapshot = (editor: ReturnType<typeof createFoundationEditor>) => editor.document.children
    .filter((node) => !isTextNode(node) && ["a", "img", "b", "c", "e"].includes(node.id))
    .map((node) => isTextNode(node) ? "" : node.type === "block_image" ? `IMG:${node.attrs?.caption}` : (node.children || []).map((child) => isTextNode(child) ? child.text : "").join(""));

  it("converges when remote edits land around both the source and the target slot", () => {
    const local = createFoundationEditor({ document: base(), selection: caret });
    const remote = createFoundationEditor({ document: base(), selection: caret });
    // Local drag: the image to between Gamma and Delta.
    const operations = planBlockMove(local.document, schema, "img", { parentId: "d", index: 4 }, { idFactory: createNodeId })!;
    const moveTx = local.transact((builder) => { builder.operations.push(...operations); return builder.selectionAfter; }, { authorId: "local", addToHistory: true })!;
    // Concurrent remote edits next to the source (Alpha, Beta) and the target (Gamma, Delta), plus a new block above everything.
    const at = (id: string) => remote.document.children.findIndex((node) => !isTextNode(node) && node.id === id);
    const remoteTx = remote.transact((builder) => {
      builder.operations.push(
        { type: "insertText", pos: { path: [at("a")], offset: 0 }, text: "1" },
        { type: "insertText", pos: { path: [at("b")], offset: 0 }, text: "2" },
        { type: "insertText", pos: { path: [at("c")], offset: 0 }, text: "3" },
        { type: "insertText", pos: { path: [at("e")], offset: 0 }, text: "4" },
      );
      return builder.selectionAfter;
    }, { authorId: "remote" })!;
    local.dispatch(remoteTx);
    remote.dispatch(moveTx);
    const expected = ["1Alpha", "2Beta", "3Gamma", "IMG:Cap", "4Delta"];
    expect(snapshot(local)).toEqual(expected);
    expect(snapshot(remote)).toEqual(expected);
  });

  it("a concurrent block insert in the same container is the rebase's documented moveNode conflict, and leaves both sides intact", () => {
    // collab/transform.ts deliberately treats any concurrent structural
    // change sharing an array with a moveNode as a conflict (the client
    // resyncs) - the same as Move block up/down today.
    const local = createFoundationEditor({ document: base(), selection: caret });
    const remote = createFoundationEditor({ document: base(), selection: caret });
    const operations = planBlockMove(local.document, schema, "img", { parentId: "d", index: 4 }, { idFactory: createNodeId })!;
    local.transact((builder) => { builder.operations.push(...operations); return builder.selectionAfter; }, { authorId: "local" });
    const insert = remote.transact((builder) => { builder.operations.push({ type: "insertNode", pos: { path: [], offset: 0 }, node: p("new", "New") }); return builder.selectionAfter; }, { authorId: "remote" })!;
    const before = structuredClone(local.document);
    expect(() => local.dispatch(insert)).toThrow(RebaseConflictError);
    expect(local.document).toEqual(before);
  });
});
