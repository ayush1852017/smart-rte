import { describe, expect, it } from "vitest";
import { runDualEngineListShadowCorpus } from "./legacyListShadowComparator.js";

describe("Phase 3 dual-engine list shadow corpus", () => {
  it("finds no semantic or data-loss divergence across 1,000 generated intents (seed 0xD0A10300)", () => {
    const summary = runDualEngineListShadowCorpus(1_000);
    expect(summary).toMatchObject({ scenarios: 1_000, equivalent: 1_000, divergences: {} });
    expect(JSON.stringify(summary.logs)).not.toContain("content-");
  });
});
