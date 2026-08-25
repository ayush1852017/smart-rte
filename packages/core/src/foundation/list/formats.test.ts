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
