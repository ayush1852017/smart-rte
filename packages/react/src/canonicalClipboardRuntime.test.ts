// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { insertCanonicalClipboardData, installCanonicalClipboardRuntime } from "./canonicalClipboardRuntime.js";

describe("Phase 8a ClassicEditor clipboard runtime", () => {
  it("inserts only canonical clean HTML", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    root.innerHTML = "<p>before</p>";
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const values = new Map([["text/html", '<p onclick="alert(1)">safe</p><script>alert(2)</script>'], ["text/plain", "safe"]]);
    const transfer = {
      types: [...values.keys()],
      getData: (type: string) => values.get(type) || "",
    } as unknown as DataTransfer;
    expect(insertCanonicalClipboardData(transfer, document)).toBe(true);
    const html = root.innerHTML;
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onclick|script|alert|data-smart-id|data-smart-ui/);
  });

  it("owns the product paste listener outside ClassicEditor", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p></p>";
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("p")!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const values = new Map([["text/plain", "safe"]]);
    const transfer = { types: [...values.keys()], files: [], getData: (type: string) => values.get(type) || "" } as unknown as DataTransfer;
    const beforeInsert = vi.fn(); const afterInsert = vi.fn(); const onDiagnostic = vi.fn();
    const remove = installCanonicalClipboardRuntime(root, { ownerDocument: document, beforeInsert, afterInsert, onDiagnostic });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(beforeInsert).toHaveBeenCalledOnce();
    expect(afterInsert).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ status: "parsed", detectedSource: "plain-text" }));
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("safe");
    remove();
  });

  it("reports rejected paste without allowing raw content into diagnostics", () => {
    const secret = "CLIENT-SECRET-malformed-native";
    const values = new Map([["application/x-smart-rte+json", `{${secret}`]]);
    const transfer = { types: [...values.keys()], getData: (type: string) => values.get(type) || "" } as unknown as DataTransfer;
    const onDiagnostic = vi.fn();
    expect(insertCanonicalClipboardData(transfer, document, onDiagnostic)).toBe(false);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", failureCode: "parse-failed" }));
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain(secret);
  });
});
