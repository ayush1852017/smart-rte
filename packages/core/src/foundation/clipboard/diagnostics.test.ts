// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseClipboardPayload } from "./pipeline.js";
import { reportParsedClipboard, reportRejectedClipboard } from "./diagnostics.js";

describe("privacy-safe clipboard diagnostics", () => {
  it("reports source, shape, and repair codes without document content", () => {
    const secret = "CLIENT-SECRET-acquisition-plan";
    const payload = {
      html: `<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">•&nbsp;</span>${secret}</p>`,
      plainText: `• ${secret}`,
      types: ["text/html", "text/plain"],
    };
    const fragment = parseClipboardPayload(payload, { ownerDocument: document });
    const report = reportParsedClipboard(payload, fragment);
    expect(report).toMatchObject({
      version: 1,
      detectedSource: "word",
      status: "parsed",
      structuralShape: { nodeCounts: { doc: 1, list: 1, list_item: 1, paragraph: 1, text: 1 } },
    });
    expect(report.repairs.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toMatch(/<p|mso-list|acquisition-plan/);
  });

  it("classifies rejection without leaking the exception or payload", () => {
    const secret = "CLIENT-SECRET-oversized";
    const payload = { html: `<p>${secret}</p>`, types: ["text/html"] };
    const error = Object.assign(new Error(`Rejected ${secret}`), { name: "ClipboardPayloadTooLargeError" });
    const report = reportRejectedClipboard(payload, error);
    expect(report).toMatchObject({ status: "rejected", failureCode: "payload-too-large", structuralShape: null, repairs: [] });
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
