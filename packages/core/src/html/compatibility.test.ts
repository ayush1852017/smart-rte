import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCompatibilityHtml } from "./compatibility.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/html/${name}`, import.meta.url)), "utf8").trim();

describe("HTML compatibility boundary", () => {
  const fixtureNames = [
    "simple-paragraph.html",
    "google-docs-paste.html",
    "word-table.html",
    "nested-list.html",
    "table-with-br-cell-lines.html",
    "table-with-p-tags.html",
    "quote-with-table.html",
    "code-block.html",
    "legacy-cms-content.html",
    "formulas.html",
    "colors.html",
    "media.html",
    "inline-marks.html",
    "mixed-marks.html",
    "superscript-subscript.html",
    "marks-in-table-cell.html",
    "marks-in-blockquote.html",
    "marks-with-link-color.html",
    "headings-in-table-cells.html",
  ];

  it.each(fixtureNames)("serializes fixture %s without editor-only markup", (name) => {
    const html = normalizeCompatibilityHtml(fixture(name));

    expect(html).not.toContain("data-table-wrapper");
    expect(html).not.toContain("data-srte-");
  });

  it("removes editor-only table wrappers without removing table content", () => {
    const html = normalizeCompatibilityHtml(fixture("legacy-cms-content.html"));

    expect(html).not.toContain("data-table-wrapper");
    expect(html).not.toContain("data-srte-");
    expect(html).toContain("<table>");
    expect(html).toContain("<td><p>one</p><p>two</p></td>");
  });

  it("preserves semantic blocks in representative legacy fixtures", () => {
    const nestedList = normalizeCompatibilityHtml(fixture("nested-list.html"));
    const quoteWithTable = normalizeCompatibilityHtml(fixture("quote-with-table.html"));
    const codeBlock = normalizeCompatibilityHtml(fixture("code-block.html"));

    expect(nestedList).toContain("<ul><li>Parent<ul><li>Child</li></ul></li></ul>");
    expect(quoteWithTable).toContain("<blockquote><p>Quoted</p><table>");
    expect(codeBlock).toContain("<pre><code>const value = 1;</code></pre>");
  });

  it("preserves headings and inline marks inside table cells", () => {
    const html = normalizeCompatibilityHtml(fixture("headings-in-table-cells.html"));
    expect(html).toContain("<th><h2><strong>Header</strong></h2></th>");
    expect(html).toContain("<td><p>First paragraph</p><h1>Heading one</h1><h2>Heading two</h2><h3>Heading <em>three</em></h3><p>Last paragraph</p></td>");
    expect(html).toContain("<td><p>Other cell</p></td>");
  });
});
