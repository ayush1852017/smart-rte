// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createFoundationEditor,
  createInputPipeline,
  createSubtreeRenderer,
  foundationSchema,
  repair,
  validate,
  type SmartDocument,
  type SmartElementNode,
  type SmartNode,
  type SmartSelection,
} from "../index.js";
import { parseCanonicalListHtml, serializeCanonicalListHtml, serializeCanonicalListMarkdown } from "../list/formats.js";
import { serializeClipboardRepresentations } from "../clipboard/serialization.js";
import { smartDocumentToDocxXml } from "../formats/docx/export.js";
import { atomFromHtmlElement, atomToHtml } from "./formats.js";
import {
  IMAGE_CAPTION_MAX_LENGTH,
  isValidImageCaption,
  isValidImageMetadata,
  normalizeImageCaption,
  normalizeImageMetadataAllowlist,
} from "./imageExtras.js";
import { captionlessDocument, captionlessOutputs } from "./__fixtures__/generateCaptionlessGolden.js";
import golden from "./__fixtures__/captionless-golden.json";

const image = (id: string, attrs: Record<string, unknown> = {}): SmartElementNode => ({
  type: "block_image", id, attrs: { src: `https://example.com/${id}.png`, alt: `Alt ${id}`, status: "ready", ...attrs },
});
const paragraph = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const doc = (...children: SmartNode[]): SmartDocument => ({ type: "doc", id: "doc", children });
const blocks = (html: string, options?: Parameters<typeof parseCanonicalListHtml>[1]) =>
  parseCanonicalListHtml(html, options).children as SmartElementNode[];
const allNodes = (node: SmartNode): SmartElementNode[] => "text" in node ? [] : [node as SmartElementNode, ...((node as SmartElementNode).children || []).flatMap(allNodes)];
const caret: SmartSelection = { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } };

describe("image caption + metadata schema", () => {
  it("normalises captions: control characters stripped, whitespace collapsed, capped, empty means absent", () => {
    expect(normalizeImageCaption("  A\u0000 sunny\n\t day \u0007 ")).toBe("A sunny day");
    expect(normalizeImageCaption("   ")).toBeUndefined();
    expect(normalizeImageCaption(42)).toBeUndefined();
    expect(normalizeImageCaption("x".repeat(600))).toHaveLength(IMAGE_CAPTION_MAX_LENGTH);
    expect(isValidImageCaption("A sunny day")).toBe(true);
    expect(isValidImageCaption("")).toBe(false);
    expect(isValidImageCaption(" padded ")).toBe(false);
    expect(isValidImageCaption("x".repeat(IMAGE_CAPTION_MAX_LENGTH + 1))).toBe(false);
  });

  it("accepts a valid caption/metadata on block_image and repairs away invalid ones", () => {
    const good = doc(image("a", { caption: "Hello", metadata: { "data-source": "kadal" } }));
    expect(validate(good)).toEqual([]);
    const bad = doc(image("a", { caption: "", metadata: { "data-smart-type": "x" } }));
    expect(validate(bad).map((error) => error.code)).toEqual(["invalid-attribute", "invalid-attribute"]);
    const repaired = repair(bad, foundationSchema).doc.children[0] as SmartElementNode;
    expect(repaired.attrs).not.toHaveProperty("caption");
    expect(repaired.attrs).not.toHaveProperty("metadata");
  });

  it("rejects caption and metadata on the inline image node", () => {
    const inline = doc({ type: "paragraph", id: "p", children: [
      { type: "image", id: "i", attrs: { src: "https://example.com/i.png", alt: "i", status: "ready", caption: "No", metadata: { "data-source": "x" } } },
    ] });
    expect(validate(inline).filter((error) => error.code === "invalid-attribute")).toHaveLength(2);
    const repaired = repair(inline, foundationSchema).doc;
    const inlineImage = allNodes(repaired).find((node) => node.type === "image")!;
    expect(inlineImage.attrs).not.toHaveProperty("caption");
    expect(inlineImage.attrs).not.toHaveProperty("metadata");
  });

  it("validates metadata shape and the host allowlist", () => {
    expect(isValidImageMetadata({ "data-ai-generated": "true" })).toBe(true);
    expect(isValidImageMetadata({})).toBe(false);
    expect(isValidImageMetadata({ "data-Upper": "x" })).toBe(false);
    expect(isValidImageMetadata({ "data-x": 1 })).toBe(false);
    expect(isValidImageMetadata({ "data-x": "v".repeat(501) })).toBe(false);
    expect(isValidImageMetadata(Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`data-k${index}`, "v"])))).toBe(false);
    const allowlist = normalizeImageMetadataAllowlist([
      "data-ai-generated", "data-source", "data-source", "data-smart-id", "aria-label", "data-Bad", `data-${"x".repeat(40)}`,
      ...Array.from({ length: 10 }, (_, index) => `data-extra-${index}`),
    ]);
    expect(allowlist.names).toEqual(["data-ai-generated", "data-source", ...Array.from({ length: 8 }, (_, index) => `data-extra-${index}`)]);
    expect(allowlist.rejected).toEqual(["data-smart-id", "aria-label", "data-Bad", `data-${"x".repeat(40)}`, "data-extra-8", "data-extra-9"]);
  });
});

describe("image caption HTML parsing", () => {
  it("parses a captioned third-party <figure> into one captioned block_image with no unknown node", () => {
    const parsed = blocks('<p>Before</p><figure>\n  <img src="https://example.com/a.png" alt="A" width="200">\n  <figcaption>A <b>bold</b>\n caption</figcaption>\n</figure><p>After</p>');
    expect(parsed.map((node) => node.type)).toEqual(["paragraph", "block_image", "paragraph"]);
    expect(parsed[1].attrs).toMatchObject({ src: "https://example.com/a.png", alt: "A", width: 200, caption: "A bold caption" });
    expect(validate(parseCanonicalListHtml('<figure><img src="https://example.com/a.png" alt="A"><figcaption>Cap</figcaption></figure>'))).toEqual([]);
  });

  it("parses <figure><a><img></a><figcaption> and a caption placed before the image", () => {
    expect(blocks('<figure><a href="https://example.com/page"><img src="https://example.com/a.png" alt="A"></a><figcaption>Linked</figcaption></figure>')[0].attrs)
      .toMatchObject({ src: "https://example.com/a.png", caption: "Linked" });
    expect(blocks('<figure><figcaption>First</figcaption><img src="https://example.com/a.png" alt="A"></figure>')[0].attrs)
      .toMatchObject({ caption: "First" });
  });

  it("keeps the old transparent behaviour for a multi-image figure, with its caption as a paragraph instead of unknown", () => {
    const parsed = blocks('<figure><img src="https://example.com/a.png" alt="A"><img src="https://example.com/b.png" alt="B"><figcaption>Both</figcaption></figure>');
    expect(parsed.map((node) => node.type)).toEqual(["block_image", "block_image", "paragraph"]);
    expect(parsed.every((node) => node.attrs?.caption === undefined)).toBe(true);
    expect((parsed[2].children![0] as { text: string }).text).toBe("Both");
  });

  it("turns a figcaption with no image into a paragraph, keeping its text", () => {
    const parsed = blocks("<figcaption>Orphan <em>text</em></figcaption>");
    expect(parsed.map((node) => node.type)).toEqual(["paragraph"]);
    expect(parsed[0].children).toEqual([{ type: "text", text: "Orphan " }, { type: "text", text: "text", marks: [{ type: "italic" }] }]);
    expect(blocks("<figure><p>Not an image</p><figcaption>Cap</figcaption></figure>").map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("repairs legacy flattened output (img followed by a loose figcaption) into a caption", () => {
    const legacy = '<img data-smart-type="block_image" src="https://example.com/a.png" alt="A" data-smart-status="ready">\n<figcaption>Old caption</figcaption><p>After</p>';
    const parsed = blocks(legacy);
    expect(parsed.map((node) => node.type)).toEqual(["block_image", "paragraph"]);
    expect(parsed[0].attrs?.caption).toBe("Old caption");
    // Anything other than whitespace in between breaks the association.
    expect(blocks('<img src="https://example.com/a.png" alt="A"><p>x</p><figcaption>Loose</figcaption>').map((node) => node.type))
      .toEqual(["block_image", "paragraph", "paragraph"]);
    // An already-captioned image never has its caption replaced.
    const captioned = blocks('<figure><img src="https://example.com/a.png" alt="A"><figcaption>Real</figcaption></figure><figcaption>Extra</figcaption>');
    expect(captioned[0].attrs?.caption).toBe("Real");
    expect(captioned[1].type).toBe("paragraph");
  });

  it("applies figure parsing and legacy repair inside blockquote, list item and table cell", () => {
    const figure = '<figure><img src="https://example.com/a.png" alt="A"><figcaption>Nested</figcaption></figure>';
    const flattened = '<img data-smart-type="block_image" src="https://example.com/b.png" alt="B"><figcaption>Flat</figcaption>';
    for (const wrap of [(inner: string) => `<blockquote>${inner}</blockquote>`, (inner: string) => `<ul><li>${inner}</li></ul>`, (inner: string) => `<table><tr><td>${inner}</td></tr></table>`]) {
      const nodes = allNodes(parseCanonicalListHtml(wrap(figure + flattened)));
      expect(nodes.some((node) => node.type === "unknown")).toBe(false);
      expect(nodes.filter((node) => node.type === "block_image").map((node) => node.attrs?.caption)).toEqual(["Nested", "Flat"]);
    }
  });

  it("round-trips SmartRTE's own captioned export, link, alignment and all", () => {
    const original = image("rt", { caption: "Round <trip> & \"quotes\"", href: "https://example.com/src", target: "_blank", align: "center", width: 300, height: 150, borderRadius: 4 });
    const html = serializeCanonicalListHtml(doc(original));
    const reparsed = parseCanonicalListHtml(html).children[0] as SmartElementNode;
    expect(reparsed).toEqual(original);
    expect(serializeCanonicalListHtml(parseCanonicalListHtml(html))).toBe(html);
  });

  it("restores block image alignment on reload (data-smart-align was written but never read back)", () => {
    const html = serializeCanonicalListHtml(doc(image("al", { align: "right" })), { clean: true });
    expect((parseCanonicalListHtml(html).children[0] as SmartElementNode).attrs?.align).toBe("right");
  });

  it("collects host metadata only for allowlisted names, never data-smart-*", () => {
    const html = '<img src="https://example.com/a.png" alt="A" data-ai-generated="true" data-source="kadal" data-secret="no" data-smart-x="no">';
    expect(blocks(html)[0].attrs).not.toHaveProperty("metadata");
    expect(blocks(html, { imageMetadataAttributes: ["data-ai-generated", "data-source", "data-smart-x"] })[0].attrs?.metadata)
      .toEqual({ "data-ai-generated": "true", "data-source": "kadal" });
    // The option is scoped to that one call.
    expect(blocks(html)[0].attrs).not.toHaveProperty("metadata");
    const own = serializeCanonicalListHtml(doc(image("m", { caption: "C", metadata: { "data-source": "kadal" } })));
    expect((parseCanonicalListHtml(own, { imageMetadataAttributes: ["data-source"] }).children[0] as SmartElementNode).attrs)
      .toMatchObject({ caption: "C", metadata: { "data-source": "kadal" } });
  });
});

describe("image caption export", () => {
  it("exports caption-less documents byte-identically to 1.1.x across every exporter", () => {
    const current = captionlessOutputs(captionlessDocument());
    expect(Object.keys(current)).toEqual(Object.keys(golden));
    for (const [name, value] of Object.entries(golden)) expect(current[name], name).toBe(value);
  });

  it("wraps a captioned image in <figure>/<figcaption>, keeping every attribute on the <img> and the link around the <img> only", () => {
    const html = atomToHtml(image("f", { caption: "Hi", href: "https://example.com/s", align: "center" }));
    expect(html).toBe('<figure data-smart-figure="true"><a href="https://example.com/s"><img data-smart-id="f" data-smart-type="block_image" src="https://example.com/f.png" alt="Alt f" data-smart-status="ready" data-smart-align="center" data-smart-href="https://example.com/s"></a><figcaption>Hi</figcaption></figure>');
    const template = document.createElement("template");
    template.innerHTML = html;
    expect(atomFromHtmlElement(template.content.firstElementChild!)).toEqual(image("f", { caption: "Hi", href: "https://example.com/s", align: "center" }));
  });

  it("escapes caption and metadata text instead of interpreting it", () => {
    const html = atomToHtml(image("x", { caption: "<script>alert(1)</script>", metadata: { "data-source": "\"><script>" } }));
    expect(html).toContain("<figcaption>&lt;script&gt;alert(1)&lt;/script&gt;</figcaption>");
    expect(html).toContain('data-source="&quot;&gt;&lt;script&gt;"');
    const template = document.createElement("template");
    template.innerHTML = html;
    expect(template.content.querySelector("script")).toBeNull();
  });

  it("exports captions to Markdown, plain text and DOCX", () => {
    const captioned = doc(image("c", { caption: "A *star* caption" }), paragraph("p", "After"));
    expect(serializeCanonicalListMarkdown(captioned)).toBe("![Alt c](https://example.com/c.png)\n*A \\*star\\* caption*\nAfter");
    // Block images have never been followed by a line break in plain text
    // (1.1.x behaviour, kept byte-identical); only the caption is new.
    expect(serializeClipboardRepresentations(captioned)["text/plain"]).toBe("Alt c - A *star* captionAfter");
    expect(serializeClipboardRepresentations(doc(image("d", { alt: "", decorative: true, caption: "Only caption" })))["text/plain"]).toBe("Only caption");
    const xml = smartDocumentToDocxXml(doc(image("c", { caption: "Word <caption>", align: "center" })));
    expect(xml).toContain('<w:p><w:pPr><w:jc w:val="center"/><w:pStyle w:val="Caption"/></w:pPr><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Word &lt;caption&gt;</w:t></w:r></w:p>');
  });

  it("is stable across parse -> export -> parse", () => {
    const html = '<figure><img src="https://example.com/a.png" alt="A"><figcaption>One</figcaption></figure><blockquote><figure><img src="https://example.com/b.png" alt="B"><figcaption>Two</figcaption></figure></blockquote>';
    const first = serializeCanonicalListHtml(parseCanonicalListHtml(html), { clean: true });
    expect(serializeCanonicalListHtml(parseCanonicalListHtml(first), { clean: true })).toBe(first);
  });
});

describe("image caption live rendering", () => {
  const setup = (initial: SmartDocument) => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const renderer = createSubtreeRenderer(root);
    renderer.render(initial, caret);
    return { root, renderer };
  };
  const captionFor = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-smart-projection="image-caption"][data-smart-caption-for="${id}"]`);
  const expectAdjacent = (root: HTMLElement, renderer: ReturnType<typeof createSubtreeRenderer>, id: string, text: string) => {
    const caption = captionFor(root, id);
    expect(caption?.textContent).toBe(text);
    expect(renderer.mapping.nodeToDom(id)!.nextSibling).toBe(caption);
    expect(root.querySelectorAll(`[data-smart-caption-for="${id}"]`)).toHaveLength(1);
  };

  it("creates, updates and removes the caption projection, outside the model mapping", () => {
    const initial = doc(paragraph("p0", "Top"), image("a", { caption: "First", align: "center", width: 120 }), paragraph("p1", "End"));
    const { root, renderer } = setup(initial);
    expectAdjacent(root, renderer, "a", "First");
    const caption = captionFor(root, "a")!;
    expect(caption.getAttribute("contenteditable")).toBe("false");
    expect(caption.getAttribute("aria-hidden")).toBe("true");
    expect(caption.getAttribute("data-smart-align")).toBe("center");
    expect(caption.style.maxWidth).toBe("120px");
    expect(renderer.mapping.domToNode(caption)?.nodeId).toBe("doc");
    // A caret inside/at the caption maps to just after its image.
    expect(renderer.mapping.domToPos(caption.firstChild!, 2)).toEqual({ path: [], offset: 2 });
    // Root offsets count model children only.
    expect(renderer.mapping.posToDom({ path: [], offset: 2 })).toEqual({ node: root, offset: 3 });
    expect(renderer.mapping.domToPos(root, 3)).toEqual({ path: [], offset: 2 });

    const updated = applyOperations(initial, [{ type: "setNodeAttributes", pos: { path: [1], offset: 0 }, before: initial.children[1].attrs!, after: { ...(initial.children[1] as SmartElementNode).attrs, caption: "Second" } }]);
    renderer.render(updated, caret);
    expect(captionFor(root, "a")).toBe(caption);
    expectAdjacent(root, renderer, "a", "Second");

    const { caption: _removed, ...withoutCaption } = (updated.children[1] as SmartElementNode).attrs!;
    const removed = applyOperations(updated, [{ type: "setNodeAttributes", pos: { path: [1], offset: 0 }, before: (updated.children[1] as SmartElementNode).attrs!, after: withoutCaption }]);
    renderer.render(removed, caret);
    expect(captionFor(root, "a")).toBeNull();
  });

  it("keeps the caption directly after its image through inserts, moves, deletes, undo-style reverts and nested containers", () => {
    const initial = doc(paragraph("p0", "Top"), image("a", { caption: "Cap A" }), paragraph("p1", "End"));
    const { root, renderer } = setup(initial);
    // Insert a block right after the image.
    const inserted = applyOperations(initial, [{ type: "insertNode", pos: { path: [], offset: 2 }, node: paragraph("new", "Inserted") }]);
    renderer.render(inserted, caret);
    expectAdjacent(root, renderer, "a", "Cap A");
    expect(renderer.mapping.nodeToDom("new")!.previousSibling).toBe(captionFor(root, "a"));
    // Move the image to the end (remove + insert, as a block move / remote op does).
    const imageNode = inserted.children[1];
    const moved = applyOperations(inserted, [
      { type: "removeNode", pos: { path: [], offset: 1 }, node: imageNode },
      { type: "insertNode", pos: { path: [], offset: 3 }, node: imageNode },
    ]);
    renderer.render(moved, caret);
    expectAdjacent(root, renderer, "a", "Cap A");
    expect(root.lastChild).toBe(captionFor(root, "a"));
    // Revert to the original (what undo produces) and redo again.
    renderer.render(initial, caret);
    expectAdjacent(root, renderer, "a", "Cap A");
    renderer.render(moved, caret);
    expectAdjacent(root, renderer, "a", "Cap A");
    // A captioned image inside a list item and a table cell.
    const nested = doc(
      { type: "list", id: "l", attrs: { style: "disc" }, children: [{ type: "list_item", id: "li", children: [paragraph("lp", "Item"), image("b", { caption: "In list" })] }] },
      { type: "table", id: "t", children: [{ type: "table_row", id: "r", children: [{ type: "table_cell", id: "c", attrs: { rowspan: 1, colspan: 1, header: false }, children: [image("c1", { caption: "In cell" })] }] }] },
    );
    renderer.render(nested, { type: "text", anchor: { path: [0, 0, 0], offset: 0 }, head: { path: [0, 0, 0], offset: 0 } });
    expect(captionFor(root, "a")).toBeNull();
    expectAdjacent(root, renderer, "b", "In list");
    expectAdjacent(root, renderer, "c1", "In cell");
    // Deleting the image deletes its caption.
    renderer.render(doc(paragraph("only", "x")), caret);
    expect(root.querySelector('[data-smart-projection="image-caption"]')).toBeNull();
  });

  it("selects the image when its caption is clicked", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const editor = createFoundationEditor({ document: doc(paragraph("p0", "Top"), image("a", { caption: "Click me" })), selection: caret });
    const renderer = createSubtreeRenderer(root);
    renderer.render(editor.document, editor.selection);
    const pipeline = createInputPipeline(editor, renderer, root);
    root.querySelector<HTMLElement>('[data-smart-projection="image-caption"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.selection.type).toBe("node");
    expect(editor.selection.anchor).toEqual({ path: [], offset: 1 });
    pipeline.destroy();
  });
});
