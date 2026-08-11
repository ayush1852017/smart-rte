import { describe, expect, it } from "vitest";
import { runDualEngineListShadowCorpus, runNamedListIntentCorpus } from "./legacyListShadowComparator.js";

describe("Phase 3 dual-engine list shadow corpus", () => {
  it("finds no semantic or data-loss divergence across 1,000 generated intents (seed 0xD0A10300)", () => {
    const summary = runDualEngineListShadowCorpus(1_000);
    expect(summary).toMatchObject({ scenarios: 1_000, equivalent: 1_000, divergences: {} });
    expect(JSON.stringify(summary.logs)).not.toContain("content-");
  });

  it("replays all ten named Gate 13 list intents with semantic selection comparison", () => {
    const results = runNamedListIntentCorpus();
    expect(results.map((result) => result.intent)).toEqual([
      "list.create", "list.setPreset", "list.setStyle", "list.indent", "list.outdent",
      "list.move", "list.move.reverse", "list.create.numbered", "list.setChecked", "list.unwrap",
    ]);
    expect(results.every((result) => result.selectionCompared)).toBe(true);
    expect(results.some((result) => result.classification === "data-loss" || result.classification === "semantic")).toBe(false);
  });
});
