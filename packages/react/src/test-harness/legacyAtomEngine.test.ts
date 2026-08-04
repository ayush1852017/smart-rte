// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeRetainedLegacyAtom } from "./legacyAtomEngine.js";

describe("retained pre-Phase-7 atom engine", () => {
  it("retains formula insertion before product deletion", () => {
    expect(executeRetainedLegacyAtom("<p>x</p>", { id: "formula.insert", input: { value: "x^2" } }))
      .toContain("data-formula");
  });
});
