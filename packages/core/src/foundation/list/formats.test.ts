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

  it("preserves unsupported block content and inline atoms byte-for-byte through the canonical list boundary", () => {
    const source = '<ul data-smart-id="l"><li data-smart-id="i"><blockquote data-client="x"><p>quoted</p></blockquote><p>before<img src="atom.png" alt="atom">after</p></li></ul>';
    const parsed = parseCanonicalListHtml(source);
    const html = serializeCanonicalListHtml(parsed, { fragment: true });
    expect(html).toContain('<blockquote data-client="x"><p>quoted</p></blockquote>');
    expect(html).toContain('<img src="atom.png" alt="atom">');
    expect(normalizedStructureWithoutIds(parseCanonicalListHtml(html), foundationSchema))
      .toEqual(normalizedStructureWithoutIds(parsed, foundationSchema));
    expect(serializeCanonicalListHtml(parsed, { clean: true })).not.toContain("data-smart-id");
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
});
