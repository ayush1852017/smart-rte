// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { runBlockShadowCorpus } from "./blockShadowComparator.js";

describe("Phase 5 retained legacy block shadow corpus", () => {
  it("has no unexplained semantic/data-loss divergence in 3,000 cases (seed 0xB10C2026)", () => {
    const summary = runBlockShadowCorpus(3_000);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(JSON.stringify(summary.logs)).not.toContain("plain");
    expect(JSON.stringify(summary.logs)).not.toContain("marked");
  });
});
