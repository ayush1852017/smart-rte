// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareClipboardFixture } from "./clipboardShadowComparator.js";

interface Fixture { types: string[]; representations: Record<string, string> }
const names = [
  "word-macos", "google-docs", "google-sheets", "excel", "markdown-plain-text",
  "native-smart-rte", "plain-text", "generic-web",
] as const;
const approved = Object.fromEntries(names.map((name) => [name, "expected-normalization" as const]));
const fixture = (name: string): Fixture => JSON.parse(readFileSync(`../core/src/foundation/clipboard/fixtures/captured/p0/${name}-clipboard.clipboard.json`, "utf8")) as Fixture;

describe("Phase 8a retained-engine shadow comparator", () => {
  it("logs hashes only and has no unexplained canonical data loss", () => {
    const results = names.map((name) => {
      const captured = fixture(name);
      return compareClipboardFixture(name, {
        html: captured.representations["text/html"], plainText: captured.representations["text/plain"],
        types: captured.types, representations: captured.representations,
      }, document, approved[name]);
    });
    expect(results.filter((result) => result.classification === "data-loss")).toEqual([]);
    expect(results.filter((result) => result.classification === "semantic" || result.classification === "unknown")).toEqual([]);
    expect(JSON.stringify(results)).not.toMatch(/Options:|Inhibin|<p|text\/html.*</i);
    expect(results.every((result) => /^[0-9a-f]{8}$/.test(result.legacyHash) && /^[0-9a-f]{8}$/.test(result.canonicalHash))).toBe(true);
  });
});
