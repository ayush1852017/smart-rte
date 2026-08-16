import { describe, expect, it } from "vitest";
import { assertDocxXmlWithinDepthLimit, DocxNestingTooDeepError, maxXmlNestingDepth } from "./nestingGuard.js";

describe("DOCX XML nesting depth guard", () => {
  it("measures nesting depth correctly for realistic shallow documents", () => {
    expect(maxXmlNestingDepth("<w:document><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>")).toBe(5);
  });

  it("ignores self-closing tags", () => {
    expect(maxXmlNestingDepth("<a><b/><c><d/></c></a>")).toBe(2);
  });

  it("does not count attribute values or the XML declaration as nesting", () => {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://example.com/a>b"><w:body/></w:document>';
    expect(maxXmlNestingDepth(xml)).toBe(1);
  });

  it("does not throw for depth at or under the limit", () => {
    const depth = 50;
    const xml = "<root>" + "<a>".repeat(depth) + "text" + "</a>".repeat(depth) + "</root>";
    expect(() => assertDocxXmlWithinDepthLimit(xml, 100)).not.toThrow();
  });

  it("throws DocxNestingTooDeepError for pathologically deep documents", () => {
    const depth = 10000;
    const xml = "<root>" + "<a>".repeat(depth) + "text" + "</a>".repeat(depth) + "</root>";
    expect(() => assertDocxXmlWithinDepthLimit(xml, 1000)).toThrow(DocxNestingTooDeepError);
  });

  it("computing the depth of a 10,000-level document itself does not recurse or crash", () => {
    // The guard's own implementation must never become another instance of
    // the exact bug class it exists to protect against.
    const depth = 10000;
    const xml = "<root>" + "<a>".repeat(depth) + "text" + "</a>".repeat(depth) + "</root>";
    expect(maxXmlNestingDepth(xml)).toBe(depth + 1); // +1 for <root>
  });
});
