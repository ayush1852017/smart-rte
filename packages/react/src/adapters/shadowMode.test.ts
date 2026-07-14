import { describe, expect, it, vi } from "vitest";
import { compareShadowHtml, reportShadowDifference } from "./shadowMode.js";

describe("shadow mode", () => {
  it("compares canonical HTML rather than editor-only wrapper markup", () => {
    const comparison = compareShadowHtml(
      "toggleBold",
      '<div data-table-wrapper="true"><table><tbody><tr><td>cell</td></tr></tbody></table></div>',
      "<table><tbody><tr><td>cell</td></tr></tbody></table>",
    );

    expect(comparison.matches).toBe(true);
  });

  it("treats legacy inline-tag aliases as semantic equivalents", () => {
    expect(compareShadowHtml("toggleBold", "<p><b>text</b></p>", "<p><strong>text</strong></p>").matches).toBe(true);
  });

  it("logs mismatches only through the diagnostic reporter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const comparison = compareShadowHtml("toggleBold", "<p>before</p>", "<p>after</p>");

    reportShadowDifference(comparison);

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
