import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCompatibilityHtml } from "../html/compatibility.js";
import { compatibilityHtmlToMarkdown, markdownToCompatibilityHtml } from "./compatibility.js";

const markdownFixture = readFileSync(
  fileURLToPath(new URL("../../test/fixtures/markdown/autonomic-nervous-system.md", import.meta.url)),
  "utf8",
);
const flattenedHtmlFixture = readFileSync(
  fileURLToPath(new URL("../../test/fixtures/html/autonomic-nervous-system.generated.html", import.meta.url)),
  "utf8",
);

describe("Markdown compatibility boundary", () => {
  it("preserves headings, marks, rules, nested lists, GFM tables, and Unicode", () => {
    const html = markdownToCompatibilityHtml(markdownFixture);

    expect(html).toContain("<h3><strong>A. Overview and Definition (Fundamental Concepts)</strong></h3>");
    expect(html).toContain("<h4><strong>1. Sympathetic Nervous System</strong></h4>");
    expect(html).toContain("<hr>");
    expect(html).toMatch(/<li>Key actions include:\s*<ul>/);
    expect(html).toContain("<li><strong>Sympathetic nervous system</strong>:");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("↑ HR, ↑ BP");
    expect(html).toContain("↓ HR, ↓ BP");
    expect(html).not.toContain("data-table-wrapper");
    expect(html).not.toContain("data-srte-");
  });

  it("does not invent nesting when the HTML input is already flat", () => {
    const html = normalizeCompatibilityHtml(flattenedHtmlFixture);

    expect(html).toMatch(/<li>Key actions include:<\/li>\s*<li>Increased heart rate/);
    expect(html).not.toMatch(/<li>Key actions include:\s*<ul>/);
  });

  it("round-trips formulas and inline images through portable Markdown", () => {
    const markdown = compatibilityHtmlToMarkdown(
      '<p>Energy <span data-formula="E=mc^2">rendered</span> diagram <img src="/diagram.png" alt="Diagram">.</p>',
    );
    expect(markdown).toBe("Energy $E=mc^2$ diagram ![Diagram](/diagram.png).");

    const html = markdownToCompatibilityHtml(markdown);
    expect(html).toContain('<span data-formula="E=mc^2">$E=mc^2$</span>');
    expect(html).toContain('<img src="/diagram.png" alt="Diagram">');
  });

  it("preserves display-style formula source without exposing placeholders", () => {
    const html = markdownToCompatibilityHtml("Before\n\n$$\\frac{a}{b}$$\n\nAfter");
    expect(html).toContain('data-formula="\\frac{a}{b}"');
    expect(html).not.toContain("SMART_RTE_FORMULA");
  });

  it("round-trips GFM task-list checked state", () => {
    const html = markdownToCompatibilityHtml("- [x] Done\n- [ ] Pending");
    expect(html).toContain('data-srte-checklist="true"');
    expect(html).toContain('data-srte-checked="true"');
    expect(html).toContain('data-srte-checked="false"');

    const markdown = compatibilityHtmlToMarkdown(html);
    expect(markdown).toContain("- [x] Done");
    expect(markdown).toContain("- [ ] Pending");
  });
});
