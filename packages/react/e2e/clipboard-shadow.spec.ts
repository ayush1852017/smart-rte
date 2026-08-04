import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

interface CapturedFixture {
  types: string[];
  representations: Record<string, string>;
}

const fixtureNames = [
  "word-macos",
  "google-docs",
  "google-sheets",
  "excel",
  "markdown-plain-text",
  "native-smart-rte",
  "plain-text",
  "generic-web",
] as const;

const fixtures = fixtureNames.map((fixtureId) => {
  const fixture = JSON.parse(readFileSync(
    `../core/src/foundation/clipboard/fixtures/captured/p0/${fixtureId}-clipboard.clipboard.json`,
    "utf8",
  )) as CapturedFixture;
  return {
    fixtureId,
    payload: {
      html: fixture.representations["text/html"],
      plainText: fixture.representations["text/plain"],
      native: fixture.representations["application/x-smart-rte+json"],
      types: fixture.types,
      representations: fixture.representations,
    },
  };
});

test("retained clipboard engine has no unexplained captured-corpus divergence", async ({ page }, testInfo) => {
  await page.goto("/?canonical=1");
  const results = await page.evaluate((captured) => captured.map(({ fixtureId, payload }) =>
    window.__smartCanonical!.compareClipboardFixture(fixtureId, payload)), fixtures);
  expect(results.filter((result) => ["semantic", "data-loss", "unknown"].includes(result.classification || ""))).toEqual([]);
  expect(results.every((result) => result.canonicalTextConserved)).toBe(true);
  expect(JSON.stringify(results)).not.toMatch(/<p|text\/html|Options:|Inhibin/i);
  console.log(`[phase8a][${testInfo.project.name}] clipboard-shadow=${JSON.stringify({
    scenarios: results.length,
    classifications: results.reduce<Record<string, number>>((counts, result) => {
      const classification = result.classification || "equivalent";
      counts[classification] = (counts[classification] || 0) + 1;
      return counts;
    }, {}),
  })}`);
});
