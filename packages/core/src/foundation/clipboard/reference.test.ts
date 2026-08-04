// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "../schema.js";
import { parseClipboardPayload } from "./pipeline.js";

interface ReferenceFixture {
  source: string;
  provenance?: { kind?: string; warning?: string };
  types: string[];
  representations: Record<string, string>;
}

describe("non-captured clipboard references", () => {
  it("uses the Windows DOCX conversion for parser hardening without treating it as capture evidence", () => {
    const fixture = JSON.parse(readFileSync(
      "src/foundation/clipboard/fixtures/reference/word-windows-docx-reference.json",
      "utf8",
    )) as ReferenceFixture;
    expect(fixture.source).toBe("word-windows-docx-reference");
    expect(fixture.provenance?.kind).toBe("docx-reference");
    expect(fixture.provenance?.warning).toMatch(/not Word clipboard HTML/i);
    const parsed = parseClipboardPayload({
      html: fixture.representations["text/html"],
      plainText: fixture.representations["text/plain"],
      types: fixture.types,
      representations: fixture.representations,
    }, { ownerDocument: document });
    expect(validate(parsed.document)).toEqual([]);
    const firstWord = fixture.representations["text/plain"].match(/[A-Za-z]{4,}/)?.[0];
    expect(firstWord).toBeTruthy();
    expect(JSON.stringify(parsed.document)).toContain(firstWord);
  });
});
