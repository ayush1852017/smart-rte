import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCompatibilityHtml } from "../html/compatibility.js";
import { markdownToCompatibilityHtml } from "./compatibility.js";

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
});
