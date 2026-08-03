// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { runInlineShadowCorpus } from "./inlineShadowComparator.js";

describe("Phase 4 retained legacy inline shadow corpus", () => {
  it("has no unexplained semantic/data-loss divergence in 3,000 cases (seed 0x1A4F2026)", () => {
    const summary = runInlineShadowCorpus(3_000);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(JSON.stringify(summary.logs)).not.toContain("plain formatting fixture");
  });
});
