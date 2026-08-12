// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { runAtomShadowCorpus } from "./atomShadowComparator.js";

describe("Phase 7 retained atom shadow corpus", () => {
  it("has no unexplained semantic/data-loss divergence in 2,100 cases (seed 0xA70B2027)", () => {
    const summary = runAtomShadowCorpus(2_100);
    console.log("Phase 7 atom shadow classifications", summary.divergences, summary.corrections);
    expect(summary.scenarios).toBe(2_100);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(summary.divergences.unknown).toBeUndefined();
    // Every divergence in this corpus must be an explicitly named, reviewed
    // correction — "equivalent-serialization" (an unexplained divergence) is
    // asserted to zero so a future regression can't hide in that bucket.
    expect(summary.divergences["equivalent-serialization"]).toBeUndefined();
    expect(summary.divergences["expected-normalization"]).toBe(900);
    expect(summary.corrections).toEqual({
      "unsafe-resource-url-rejected": 300,
      "unsafe-data-mime-rejected": 300,
      "canonical-preserves-alt-on-resize": 300,
    });
    expect(JSON.stringify(summary.logs)).not.toContain("fixture");
    expect(JSON.stringify(summary.logs)).not.toContain("alert");
  });
});
