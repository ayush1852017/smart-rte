import { describe, expect, it } from "vitest";
import { getSmartListPreset, isSmartListPreset, listStyleForPresetDepth, SMART_LIST_PRESETS } from "./listPresets.js";

describe("list presets", () => {
  it("defines six stable presets for each list kind", () => {
    expect(SMART_LIST_PRESETS.filter((preset) => preset.kind === "ordered")).toHaveLength(6);
    expect(SMART_LIST_PRESETS.filter((preset) => preset.kind === "bullet")).toHaveLength(6);
  });

  it("maps the upper-alpha family across nested depths", () => {
    expect([0, 1, 2, 3].map((depth) => listStyleForPresetDepth("ordered-upper-alpha", depth)))
      .toEqual(["upper-alpha", "lower-alpha", "lower-roman", "lower-roman"]);
  });

  it("keeps outline numbering decimal at every depth", () => {
    expect(getSmartListPreset("ordered-outline").outline).toBe(true);
    expect([0, 1, 2].map((depth) => listStyleForPresetDepth("ordered-outline", depth)))
      .toEqual(["decimal", "decimal", "decimal"]);
  });

  it("exposes only catalogued preset IDs", () => {
    expect(isSmartListPreset("bullet-circle")).toBe(false);
    expect(new Set(SMART_LIST_PRESETS.map((preset) => preset.id)).size).toBe(12);
  });
});
