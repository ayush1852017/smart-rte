import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  canonicalListPdfText,
  canonicalListToDocxNumbering,
  normalizedStructureWithoutIds,
  parseCanonicalListHtml,
  parseCanonicalListMarkdown,
  serializeCanonicalListHtml,
  serializeCanonicalListMarkdown,
  foundationSchema,
  validate,
  type SmartDocument,
} from "../index.js";

const fixture: SmartDocument = { type: "doc", id: "doc", children: [{
  type: "list", id: "list", attrs: { preset: "ordered-outline", style: "upper-roman", start: 4, checkable: true }, children: [
    { type: "list_item", id: "a", attrs: { checked: true, numberOverride: 7 }, children: [
      { type: "heading", id: "a-h", attrs: { level: 2 }, children: [{ type: "text", text: "Alpha" }] },
      { type: "paragraph", id: "a-p2", children: [{ type: "text", text: "Second block" }] },
      { type: "list", id: "nested", attrs: { style: "disc", checkable: true }, children: [
        { type: "list_item", id: "nested-a", attrs: { checked: false }, children: [{ type: "paragraph", id: "nested-p", children: [{ type: "text", text: "Nested" }] }] },
      ] },
    ] },
    { type: "list_item", id: "b", attrs: { checked: false }, children: [{ type: "paragraph", id: "b-p", children: [{ type: "text", text: "Beta" }] }] },
  ],
}] };

describe("Phase 3 list format fidelity", () => {
  it("round-trips full canonical HTML including hierarchy, IDs, preset, style, restart, and checked state", () => {
    const html = serializeCanonicalListHtml(fixture);
    expect(html).toContain('data-smart-list-preset="ordered-outline"');
    expect(html).toContain('start="4"');
    expect(html).toContain('data-smart-checked="true"');
    const parsed = parseCanonicalListHtml(html);
    expect(normalizedStructureWithoutIds(parsed, foundationSchema)).toEqual(normalizedStructureWithoutIds(fixture, foundationSchema));
    expect(parsed).toEqual(fixture);
  });

  it("supports clean HTML with IDs stripped and imports sibling-style legacy nesting", () => {
    expect(serializeCanonicalListHtml(fixture, { clean: true })).not.toContain("data-smart-id");
    const legacy = parseCanonicalListHtml('<ul><li>Parent</li><ul><li>Child</li></ul></ul>');
    expect(legacy.children[0]).toMatchObject({ type: "list", children: [{ type: "list_item", children: [
      { type: "paragraph", children: [{ text: "Parent" }] },
      { type: "list", children: [{ type: "list_item", children: [{ type: "paragraph", children: [{ text: "Child" }] }] }] },
    ] }] });
  });

  it("canonicalizes migrated blockquotes and supported inline atoms without losing content", () => {
    const source = '<ul data-smart-id="l"><li data-smart-id="i"><blockquote data-client="x"><p>quoted</p></blockquote><p>before<img src="atom.png" alt="atom">after</p></li></ul>';
    const parsed = parseCanonicalListHtml(source);
    const html = serializeCanonicalListHtml(parsed, { fragment: true });
    expect(html).toMatch(/<blockquote data-smart-id="[^"]+"><p data-smart-id="[^"]+">quoted<\/p><\/blockquote>/);
    expect(html).toMatch(/<img data-smart-id="[^"]+" data-smart-type="image" src="atom\.png" alt="atom" data-smart-status="ready">/);
    expect(normalizedStructureWithoutIds(parseCanonicalListHtml(html), foundationSchema))
      .toEqual(normalizedStructureWithoutIds(parsed, foundationSchema));
    expect(serializeCanonicalListHtml(parsed, { clean: true })).not.toContain("data-smart-id");
  });

  it("preserves a pasted image's size from inline style or legacy width/height attributes, for both inline and block images", () => {
    // A pasted image's size was silently dropped: the inline `image`
    // parser only ever read the legacy width/height HTML attributes
    // (never inline `style`, which is how most real-world sources - Google
    // Docs, most web pages, this app's own copy output for other atoms -
    // actually express size), and the block_image parser read no size at
    // all, attribute or style. See docs/bugs/ for the full writeup.
    const styleSized = parseCanonicalListHtml('<p><img src="a.png" alt="A" style="width: 400px; height: 300px;"></p>');
    expect(styleSized.children[0]).toMatchObject({ type: "paragraph", children: [
      { type: "image", attrs: { width: 400, height: 300 } },
    ] });

    const attrSized = parseCanonicalListHtml('<p><img src="a.png" alt="A" width="120" height="90"></p>');
    expect(attrSized.children[0]).toMatchObject({ type: "paragraph", children: [
      { type: "image", attrs: { width: 120, height: 90 } },
    ] });

    // Style must win when a source sets both (a percentage/inline-style
    // resize applied over a stale legacy attribute).
    const stylePrecedence = parseCanonicalListHtml('<p><img src="a.png" alt="A" width="120" height="90" style="width: 400px; height: 300px;"></p>');
    expect(stylePrecedence.children[0]).toMatchObject({ type: "paragraph", children: [
      { type: "image", attrs: { width: 400, height: 300 } },
    ] });

    const blockStyleSized = parseCanonicalListHtml('<img data-smart-type="block_image" src="b.png" alt="B" style="width: 250px; height: 150px;">');
    expect(blockStyleSized.children[0]).toMatchObject({ type: "block_image", attrs: { width: 250, height: 150 } });

    const blockAttrSized = parseCanonicalListHtml('<img data-smart-type="block_image" src="b.png" alt="B" width="60" height="45">');
    expect(blockAttrSized.children[0]).toMatchObject({ type: "block_image", attrs: { width: 60, height: 45 } });

    // No size specified anywhere - width/height must stay absent, not
    // fabricated to 0 or NaN.
    const unsized = parseCanonicalListHtml('<p><img src="a.png" alt="A"></p>');
    const unsizedImage = (unsized.children[0] as SmartDocument).children?.[0];
    expect((unsizedImage?.attrs as Record<string, unknown> | undefined)?.width).toBeUndefined();
    expect((unsizedImage?.attrs as Record<string, unknown> | undefined)?.height).toBeUndefined();

    // A percentage is a proportion, not a pixel count - guessing it means
    // literal pixels (parseFloat("50%") === 50) would badly undersize the
    // image, so it must be rejected the same way table column widths are.
    const percentSized = parseCanonicalListHtml('<p><img src="a.png" alt="A" style="width: 50%;"></p>');
    const percentImage = (percentSized.children[0] as SmartDocument).children?.[0];
    expect((percentImage?.attrs as Record<string, unknown> | undefined)?.width).toBeUndefined();
  });

  it("round-trips a pasted image's size through this app's own copy output", () => {
    // The most testable reproduction: copying an image atom out of this
    // editor and pasting it back in must preserve size, since the outbound
    // serializer (atomToHtml) already writes width/height as HTML
    // attributes on both `<img data-smart-type="image">` and
    // `<img data-smart-type="block_image">`.
    const doc: SmartDocument = {
      type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p1", children: [{ type: "image", id: "i1", attrs: { src: "https://x.test/a.png", alt: "A", width: 400, height: 300 } }] },
        { type: "block_image", id: "bi1", attrs: { src: "https://x.test/b.png", alt: "B", width: 250, height: 150 } },
      ],
    };
    const html = serializeCanonicalListHtml(doc, { clean: true });
    const parsed = parseCanonicalListHtml(html);
    expect(normalizedStructureWithoutIds(parsed, foundationSchema)).toEqual(normalizedStructureWithoutIds(doc, foundationSchema));
  });

  it("excludes checklist editor UI controls from canonical content", () => {
    const parsed = parseCanonicalListHtml(
      '<ul data-srte-checklist="true"><li><button data-smart-ui="check-control" data-srte-check="true">UI</button><p>Task</p></li></ul>',
    );
    const html = serializeCanonicalListHtml(parsed, { clean: true });

    expect(html).toContain("Task");
    expect(html).not.toContain("check-control");
    expect(html).not.toContain(">UI<");
  });

  it("round-trips Markdown hierarchy/order/tasks while intentionally losing presets", () => {
    const markdown = serializeCanonicalListMarkdown(fixture);
    expect(markdown).toContain("4. [x] Alpha");
    expect(markdown).toContain("    - [ ] Nested");
    expect(markdown).not.toContain("ordered-outline");
    const parsed = parseCanonicalListMarkdown(markdown);
    expect(parsed.children[0]).toMatchObject({ type: "list", attrs: { style: "decimal", start: 4, checkable: true }, children: [
      { attrs: { checked: true }, children: [
        { type: "paragraph", children: [{ text: "Alpha" }] },
        { type: "paragraph", children: [{ text: "Second block" }] },
        { type: "list" },
      ] },
      { attrs: { checked: false }, children: [{ type: "paragraph", children: [{ text: "Beta" }] }] },
    ] });
  });

  it("round-trips inline images, block images, and formulas through Markdown instead of silently dropping them", () => {
    // Phase 9 SS2.3: markdownInlineText/markdownBlock's fallback for any
    // non-text, non-hard_break inline/block node was `""` - image and
    // formula atoms were silently deleted on export with zero trace, not
    // merely reformatted. See docs/bugs/ for the full writeup.
    const doc: SmartDocument = {
      type: "doc", id: "doc",
      children: [
        { type: "paragraph", id: "p1", children: [
          { type: "text", text: "before " },
          { type: "image", id: "i1", attrs: { src: "https://x.test/a.png", alt: "A" } },
          { type: "text", text: " and " },
          { type: "formula", id: "f1", attrs: { source: "x^2", notation: "latex" } },
        ] },
        { type: "block_image", id: "bi1", attrs: { src: "https://x.test/b.png", alt: "B" } },
        { type: "block_formula", id: "bf1", attrs: { source: "y=mx+b", notation: "latex" } },
      ],
    };
    const markdown = serializeCanonicalListMarkdown(doc);
    expect(markdown).toContain("![A](https://x.test/a.png)");
    expect(markdown).toContain("$x^2$");
    expect(markdown).toContain("![B](https://x.test/b.png)");
    expect(markdown).toContain("$$\ny=mx+b\n$$");

    const parsed = parseCanonicalListMarkdown(markdown);
    const flat = JSON.stringify(parsed);
    expect(flat).toContain('"type":"image"');
    expect((flat.match(/"type":"image"/g) || []).length).toBe(2);
    expect(flat).toContain('"source":"x^2"');
    expect(flat).toContain('"source":"y=mx+b"');
  });

  it("maps DOCX semantics to numId/ilvl and documents preset fallback through marker family", () => {
    const entries = canonicalListToDocxNumbering(fixture);
    expect(entries).toEqual([
      { itemId: "a", numId: 1, ilvl: 0, marker: "decimal", text: "Alpha", checked: true },
      { itemId: "nested-a", numId: 1, ilvl: 1, marker: "bullet", text: "Nested", checked: false },
      { itemId: "b", numId: 1, ilvl: 0, marker: "decimal", text: "Beta", checked: false },
    ]);
    expect(JSON.stringify(entries)).not.toContain("ordered-outline");
  });

  it("declares PDF output visual-only", () => {
    const text = canonicalListPdfText(fixture);
    expect(text).toBe("1. Alpha\n  • Nested\n1. Beta");
    expect(text).not.toContain("checked");
    expect(text).not.toContain("ordered-outline");
  });

  it("round-trips Unicode special characters through HTML and Markdown, matching the declared full fidelity", () => {
    const unicode: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "text", text: "café — “quoted” 中文 😀 → ½" }] },
    ] };
    const html = serializeCanonicalListHtml(unicode);
    expect(normalizedStructureWithoutIds(parseCanonicalListHtml(html), foundationSchema))
      .toEqual(normalizedStructureWithoutIds(unicode, foundationSchema));

    const markdown = serializeCanonicalListMarkdown(unicode);
    expect(markdown).toContain("café — “quoted” 中文 😀 → ½");
    const parsedMarkdown = parseCanonicalListMarkdown(markdown);
    expect((parsedMarkdown.children[0] as { children?: Array<{ text?: string }> }).children?.[0]?.text)
      .toBe("café — “quoted” 中文 😀 → ½");
  });

  /**
   * Post-Phase-11.5 bug batch item 1: a real Sootr export
   * (packages/react/e2e/fixtures/test-html-sootr.html, exercised end-to-end
   * by that package's own paste e2e test) has a <blockquote> whose inline
   * content is bare <span> runs with no wrapping <p>, and a <table> wrapped
   * in nested <div>s - both fell through parseBlock's generic
   * "unrecognized tag" fallback into `unknown` nodes ("[Unsupported:
   * span]"/"[Unsupported: div]") instead of being parsed as text/marks or
   * a real table. This is the minimal, self-contained reproduction of that
   * same defect shape, isolated at the core-package level.
   */
  it("parses span-wrapped blockquote content and div-wrapped tables instead of falling back to unknown nodes", () => {
    const html = '<blockquote><span style="white-space: pre-wrap"><span style="font-weight: bolder">Heads up:<br></span></span>'
      + '<span style="white-space: pre-wrap">- first point</span></blockquote>'
      + '<div align="left"><div data-table-wrapper="true"><table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table></div></div>';
    const doc = parseCanonicalListHtml(html);
    const collect = (node: SmartDocument | SmartDocument["children"][number], out: unknown[] = []): unknown[] => {
      out.push(node);
      ("children" in node ? node.children || [] : []).forEach((child) => collect(child as SmartDocument["children"][number], out));
      return out;
    };
    const all = collect(doc) as Array<{ type: string; text?: string; marks?: Array<{ type: string }> }>;
    expect(all.filter((node) => node.type === "unknown")).toEqual([]);

    const blockquote = doc.children.find((node) => node.type === "blockquote") as SmartDocument;
    expect(blockquote).toBeDefined();
    const blockquoteText = all.filter((node) => node.type === "text").map((node) => node.text).join("");
    expect(blockquoteText).toContain("Heads up:");
    expect(blockquoteText).toContain("- first point");
    const headsUp = all.find((node) => node.type === "text" && node.text === "Heads up:");
    expect(headsUp?.marks).toEqual([{ type: "bold" }]);

    const table = doc.children.find((node) => node.type === "table") as SmartDocument | undefined;
    expect(table).toBeDefined();
    expect(table?.children).toHaveLength(1);
  });

  /**
   * 2026-08-26: reported as "images copied from the web render as
   * [Unsupported: img]". Confirmed via real captured clipboard HTML (an
   * actual Ctrl+C from a live Wikipedia page's infobox photo, driven
   * through Playwright's clipboard permissions - not synthesized) that
   * this specific real image already parsed fine (Wikipedia always wraps
   * its images inside a <td>/<span>, which textWithMarks's inline path
   * already handled) - the real gap was a THIRD-PARTY <img> sitting
   * directly at block level (not wrapped in a <p>), which parseBlock had
   * no case for at all. This is the ordinary shape for a standalone
   * content photo on most real sites (a bare <img> between paragraphs, or
   * one wrapped in a <figure>, which is now a transparent container).
   */
  it("parses a bare block-level <img> (and one wrapped in <figure>) into a block_image instead of falling back to unknown", () => {
    const src = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Golden_Gate_Bridge_as_seen_from_Battery_East.jpg";
    const bare = parseCanonicalListHtml(`<p>Some text before.</p><img src="${src}" width="290" height="181" alt="A bridge"><p>Some text after.</p>`);
    expect(bare.children.map((node) => node.type)).toEqual(["paragraph", "block_image", "paragraph"]);
    expect((bare.children[1] as SmartDocument).attrs).toMatchObject({ src, width: 290, height: 181, alt: "A bridge" });
    expect(validate(bare, foundationSchema)).toEqual([]);

    // <figcaption> itself is a known, accepted remaining gap (not a
    // recognized block tag, so it still falls to "unknown") - out of
    // scope for this fix, which is specifically about the image no longer
    // disappearing. <figure> being flattened as a transparent container
    // means the image now parses independently of that caption's fate.
    const figureWrapped = parseCanonicalListHtml(`<figure><img src="${src}" width="290" height="181" alt="A bridge"><figcaption>Caption</figcaption></figure>`);
    expect(figureWrapped.children.some((node) => node.type === "block_image")).toBe(true);
    expect(validate(figureWrapped, foundationSchema)).toEqual([]);
  });

  /**
   * The more common real gesture ("right-click an image, Copy image", not
   * select-a-range-then-copy) produces an even sparser clipboard payload -
   * confirmed via an actual browser capture (selecting just the image
   * element and copying it, the closest scriptable equivalent of that
   * native command, against the same live Wikipedia photo): a bare
   * `<a href="..."><img ...></a>`, no other wrapper at all. `packages/
   * react/e2e/fixtures/web-image-only-clipboard.html` is that literal,
   * unmodified capture, kept permanently per this project's real-fixture
   * convention. A link wrapping nothing but a single image, at block
   * level, unwraps to the image the same way the bare-<img> case does.
   */
  it("parses a real captured 'copy image' clipboard payload (<a> wrapping only an <img>) into a block_image", () => {
    const html = readFileSync(new URL("../../../../react/e2e/fixtures/web-image-only-clipboard.html", import.meta.url), "utf8");
    const doc = parseCanonicalListHtml(html);
    expect(doc.children.map((node) => node.type)).toEqual(["block_image"]);
    expect((doc.children[0] as SmartDocument).attrs).toMatchObject({
      src: expect.stringContaining("Golden_Gate_Bridge"), width: 290, height: 181,
    });
    expect(validate(doc, foundationSchema)).toEqual([]);
  });

  /** Same report, second item: <hr> also fell to "[Unsupported: hr]" - no node type existed for it at all. */
  it("parses <hr> into a divider atom and round-trips it through HTML export", () => {
    const doc = parseCanonicalListHtml("<p>Before</p><hr><p>After</p>");
    expect(doc.children.map((node) => node.type)).toEqual(["paragraph", "divider", "paragraph"]);
    expect(validate(doc, foundationSchema)).toEqual([]);

    const exported = serializeCanonicalListHtml(doc);
    expect(exported).toContain("<hr");
    const reparsed = parseCanonicalListHtml(exported);
    expect(reparsed.children.map((node) => node.type)).toEqual(["paragraph", "divider", "paragraph"]);
  });

  /**
   * Post-Phase-11.5 bug batch item 2: a pasted table visibly shrank
   * because a <col> with no real pixel width data (empty, a percentage,
   * or another CSS unit like Excel's "pt") got an arbitrary 120px
   * fallback - once the renderer started pinning a table's own width to
   * the literal sum of columnWidths (item 6 of the prior batch), that
   * fabricated 120px-per-column default became the table's real,
   * visible, far-too-small size instead of being invisibly overridden by
   * the stylesheet's width:100% default. Fixed all-or-nothing: only set
   * columnWidths when every <col> has a genuine, parseable pixel width.
   */
  it("only sets table columnWidths when every <col> has a real pixel width, not a fabricated fallback", () => {
    const pxTable = '<table><colgroup><col style="width:80px"><col width="200"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect((parseCanonicalListHtml(pxTable).children[0] as SmartDocument).attrs).toMatchObject({ columnWidths: [80, 200] });

    const emptyColsTable = '<table><colgroup><col><col></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect((parseCanonicalListHtml(emptyColsTable).children[0] as SmartDocument).attrs?.columnWidths).toBeUndefined();

    const percentTable = '<table><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect((parseCanonicalListHtml(percentTable).children[0] as SmartDocument).attrs?.columnWidths).toBeUndefined();

    const mixedTable = '<table><colgroup><col style="width:80px"><col></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    expect((parseCanonicalListHtml(mixedTable).children[0] as SmartDocument).attrs?.columnWidths).toBeUndefined();

    // Excel's own export shape: a real pixel `width` attribute alongside a
    // `style="width:...pt"` that isn't pixels - the attribute must win,
    // not a parseFloat of the point value.
    const excelShapeTable = '<table><colgroup><col width="19" style="width:14pt"></colgroup><tbody><tr><td>a</td></tr></tbody></table>';
    expect((parseCanonicalListHtml(excelShapeTable).children[0] as SmartDocument).attrs).toMatchObject({ columnWidths: [19] });
  });
});

// docs/bugs/formula-not-rendered-in-static-html-consumers.md: the live
// editing surface renders formulas via surface/renderer.ts's imperative
// katex.render() calls, which never touch this serialization path - a
// consumer that displays onHtmlChange's HTML string directly (a read-only
// preview) got an empty placeholder span with no visible math at all.
describe("serializeCanonicalListHtml renderFormulaHtml option", () => {
  const inlineFormulaDoc: SmartDocument = { type: "doc", id: "doc", children: [
    { type: "paragraph", id: "p", children: [{ type: "formula", id: "f", attrs: { source: "E=mc^2", notation: "latex" } }] },
  ] };

  it("defaults to an empty placeholder, unchanged from before this option existed", () => {
    const html = serializeCanonicalListHtml(inlineFormulaDoc);
    expect(html).toContain('data-smart-formula="E=mc^2"');
    expect(html).toMatch(/data-smart-type="formula"[^>]*><\/span>/);
  });

  it("bakes real KaTeX HTML into the formula element when renderFormulaHtml is true", () => {
    const html = serializeCanonicalListHtml(inlineFormulaDoc, { renderFormulaHtml: true });
    expect(html).toContain('data-smart-formula="E=mc^2"');
    expect(html).toContain('class="katex"');
    expect(html).toContain("MathML");
  });

  it("supports \\ce{...} chemistry notation, matching the live renderer's own mhchem import", () => {
    const chemistryDoc: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "block_formula", id: "f", attrs: { source: "\\ce{H2O}", notation: "latex" } },
    ] };
    const html = serializeCanonicalListHtml(chemistryDoc, { renderFormulaHtml: true });
    expect(html).toContain('class="katex"');
  });

  it("falls back to escaped plain text on invalid LaTeX, matching the live renderer's own try/catch fallback - never throws", () => {
    const invalidDoc: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "formula", id: "f", attrs: { source: "\\frac{1", notation: "latex" } }] },
    ] };
    expect(() => serializeCanonicalListHtml(invalidDoc, { renderFormulaHtml: true })).not.toThrow();
    const html = serializeCanonicalListHtml(invalidDoc, { renderFormulaHtml: true });
    expect(html).toContain("\\frac{1");
    expect(html).not.toContain('class="katex"');
  });

  it("round-trips correctly regardless of the baked-in HTML - the model only ever reads the data-smart-formula attribute, never the rendered children", () => {
    const html = serializeCanonicalListHtml(inlineFormulaDoc, { renderFormulaHtml: true });
    const parsed = parseCanonicalListHtml(html);
    const formulaNode = (parsed.children[0] as SmartDocument).children?.[0] as SmartDocument;
    expect(formulaNode.type).toBe("formula");
    expect(formulaNode.attrs).toMatchObject({ source: "E=mc^2", notation: "latex" });
  });

  it("is off by default for the clean/fragment variants too, and combines correctly with clean:true", () => {
    const cleanHtml = serializeCanonicalListHtml(inlineFormulaDoc, { clean: true, renderFormulaHtml: true });
    expect(cleanHtml).not.toContain("data-smart-id");
    expect(cleanHtml).toContain('class="katex"');
  });
});

// docs/bugs/media-details-old-editor-field-parity.md
describe("image link (href/target) parsing", () => {
  it("preserves an inline image's link when re-parsing this app's own exported HTML (data-smart-href on the <img>, wrapped in a real <a>)", () => {
    const doc: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "image", id: "img", attrs: { src: "https://x.test/i.png", alt: "x", href: "https://x.test/dest", target: "_blank" } }] },
    ] };
    const html = serializeCanonicalListHtml(doc);
    expect(html).toContain("<a href=");
    const parsed = parseCanonicalListHtml(html);
    const imageNode = (parsed.children[0] as SmartDocument).children?.[0] as SmartDocument;
    expect(imageNode.attrs).toMatchObject({ href: "https://x.test/dest", target: "_blank" });
  });

  it("preserves a block image's link the same way", () => {
    const doc: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "block_image", id: "img", attrs: { src: "https://x.test/i.png", alt: "x", href: "https://x.test/dest" } },
    ] };
    const parsed = parseCanonicalListHtml(serializeCanonicalListHtml(doc));
    expect((parsed.children[0] as SmartDocument).attrs).toMatchObject({ href: "https://x.test/dest" });
  });

  /**
   * A real, previously-confirmed reproduction (an actual browser "copy
   * image" against a live Wikipedia photo): the clipboard payload was a
   * bare <a href="..."><img></a> with none of this app's own data-smart-*
   * markers - the link target is the source page, not something a user
   * authored via this feature, and was already deliberately dropped rather
   * than preserved (see list/formats.ts's own comment at the block-level
   * <a> unwrap). Confirming that decision still holds now that this
   * feature gives block_image somewhere real to put a link, rather than
   * silently reversing it as an unintended side effect.
   */
  it("still drops an incidental third-party <a> wrapper around a block-level image with no data-smart-* markers", () => {
    const thirdParty = '<a href="https://en.wikipedia.org/wiki/File:Example.jpg"><img src="https://x.test/i.png" alt="x"></a>';
    const parsed = parseCanonicalListHtml(thirdParty);
    expect((parsed.children[0] as SmartDocument).attrs).not.toHaveProperty("href");
  });

  it("preserves a third-party inline <a><img></a> link (a common, intentional pattern - an icon/badge image that's also a hyperlink), unlike the block-level case above", () => {
    const thirdPartyInline = '<p><a href="https://x.test/badge-dest"><img src="https://x.test/badge.png" alt="badge"></a></p>';
    const parsed = parseCanonicalListHtml(thirdPartyInline);
    const paragraph = parsed.children[0] as SmartDocument;
    const imageNode = paragraph.children?.[0] as SmartDocument;
    expect(imageNode.type).toBe("image");
    expect(imageNode.attrs).toMatchObject({ href: "https://x.test/badge-dest" });
  });
});

describe("image atom schema: href/target/borderRadius validation (atom/schema.ts's imageAttrs)", () => {
  const docWith = (attrs: Record<string, unknown>): SmartDocument => ({
    type: "doc", id: "doc", children: [
      { type: "paragraph", id: "p", children: [{ type: "image", id: "i", attrs: { src: "https://x.test/i.png", alt: "x", ...attrs } }] },
    ],
  });

  it("accepts a safe href and rejects an unsafe one, matching the link mark's own normalizeLinkInput validation", () => {
    expect(validate(docWith({ href: "https://safe.test" }), foundationSchema)).toEqual([]);
    expect(validate(docWith({ href: "javascript:alert(1)" }), foundationSchema).length).toBeGreaterThan(0);
  });

  it("accepts a non-negative borderRadius and rejects a negative one", () => {
    expect(validate(docWith({ borderRadius: 12 }), foundationSchema)).toEqual([]);
    expect(validate(docWith({ borderRadius: -1 }), foundationSchema).length).toBeGreaterThan(0);
  });
});
