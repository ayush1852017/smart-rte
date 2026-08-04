// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { legacyCleanPastedHtml } from "./legacyClipboardEngine.js";

describe("Phase 8a retained legacy clipboard harness", () => {
  it("preserves the production cleaner's allowlist behavior", () => {
    const output = legacyCleanPastedHtml(
      '<style>p{color:red}</style><p id="x" class="Word" style="font-weight:700;color:red;position:fixed">A&nbsp;B</p>',
    );
    expect(output).toBe('<p style="font-weight:700">A B</p>');
  });

  it("records the legacy cleaner's known security limitation for shadow comparison", () => {
    const output = legacyCleanPastedHtml('<img src="javascript:alert(1)" onerror="alert(2)">');
    expect(output).toContain("onerror");
    expect(output).toContain("javascript:alert(1)");
  });
});
