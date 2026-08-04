// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { insertCanonicalClipboardData } from "./canonicalClipboardRuntime.js";

describe("Phase 8a ClassicEditor clipboard runtime", () => {
  it("inserts only canonical clean HTML", () => {
    const values = new Map([["text/html", '<p onclick="alert(1)">safe</p><script>alert(2)</script>'], ["text/plain", "safe"]]);
    const transfer = {
      types: [...values.keys()],
      getData: (type: string) => values.get(type) || "",
    } as unknown as DataTransfer;
    const insert = vi.fn((_command: string, _showUi: boolean, _value: string) => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: insert });
    expect(insertCanonicalClipboardData(transfer, document)).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    const html = String(insert.mock.calls[0][2]);
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onclick|script|alert|data-smart-id|data-smart-ui/);
  });
});
