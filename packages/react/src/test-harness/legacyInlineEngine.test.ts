import { describe, expect, it } from "vitest";
import { legacyInlineToolIds } from "./legacyInlineEngine.js";

describe("Phase 4 retained legacy inline harness", () => {
  it("is frozen before production deletion and covers all twelve tools", () => {
    expect(legacyInlineToolIds).toEqual([
      "bold", "italic", "underline", "strike", "code", "superscript", "subscript",
      "textColor", "backgroundColor", "fontSize", "fontFamily", "link",
    ]);
    expect(Object.isFrozen(legacyInlineToolIds)).toBe(true);
  });
});
