// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ClipboardPayloadTooLargeError, DEFAULT_MAX_CLIPBOARD_BYTES, parseClipboardPayload } from "./pipeline.js";
import { detectClipboardSource } from "./detection.js";
import { serializeClipboardRepresentations } from "./serialization.js";
import { NATIVE_CLIPBOARD_MIME, type SourceNormalizer } from "./types.js";
import type { SmartDocument } from "../types.js";

describe("Phase 8a clipboard security boundary", () => {
  it("structurally sanitizes before invoking a source normalizer", () => {
    let observed = "";
    const normalizer: SourceNormalizer = {
      id: "order-probe",
      sources: ["html"],
      normalize(payload) {
        observed = payload.html;
        return { html: payload.html, plainText: payload.plainText, repairs: [] };
      },
    };
    parseClipboardPayload({
      html: '<p onclick="alert(1)">safe</p><script>alert(2)</script>',
      plainText: "safe",
    }, { ownerDocument: document, normalizers: [normalizer] });
    expect(observed).toContain("safe");
    expect(observed).not.toMatch(/onclick|script|alert/);
  });

  it.each([
    ['<img src="javascript:alert(1)" onerror="alert(2)"><p>kept</p>', /javascript:|onerror/i, true],
    ['<svg><a xlink:href="javascript:alert(1)">x</a></svg><p>kept</p>', /svg|javascript:/i, true],
    ['<p style="background:url(javascript:alert(1))">kept</p>', /style=|javascript:/i, true],
    ['<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>"></math><p>kept</p>', /onerror|<style/i, false],
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe><p>kept</p>', /iframe|srcdoc|script/i, true],
  ])("neutralizes synthesized hostile HTML fixture %#", (html, hostilePattern, retainsVisibleText) => {
    const result = parseClipboardPayload({ html, plainText: "kept" }, { ownerDocument: document });
    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toMatch(hostilePattern);
    if (retainsVisibleText) expect(serialized).toContain("kept");
  });

  it("reuses the shared URL policy while retaining allowed image data URLs", () => {
    const result = parseClipboardPayload({
      html: '<p><img src="data:image/png;base64,AA=="><a href="vbscript:msgbox(1)">label</a></p>',
      plainText: "label",
    }, { ownerDocument: document });
    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toContain("vbscript:");
  });

  it("preserves a sanitized safe custom element as an unknown node", () => {
    const result = parseClipboardPayload({ html: '<x-customer-widget data-kind="safe">customer content</x-customer-widget>' }, { ownerDocument: document });
    expect(result.document.children[0]).toMatchObject({ type: "unknown", attrs: { originalType: "x-customer-widget", editable: false } });
    expect(JSON.stringify(result.document)).toContain("customer content");
  });

  it("preserves 1,000 generated unknown elements non-destructively (seed 0x8a0bad)", () => {
    let seed = 0x8a0bad;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let run = 0; run < 1_000; run += 1) {
      const value = random();
      const type = `x-customer-${value.toString(36)}`;
      const content = `unknown-content-${run}-${random()}`;
      const result = parseClipboardPayload({
        html: `<${type} data-safe="${value}">${content}</${type}>`,
      }, { ownerDocument: document });
      expect(result.document.children[0]).toMatchObject({
        type: "unknown",
        attrs: { originalType: type, editable: false },
      });
      expect(JSON.stringify(result.document)).toContain(content);
    }
  });

  it("refuses oversized input with a clear diagnostic", () => {
    const html = `<p>${"x".repeat(DEFAULT_MAX_CLIPBOARD_BYTES)}</p>`;
    expect(() => parseClipboardPayload({ html }, { ownerDocument: document })).toThrow(ClipboardPayloadTooLargeError);
  });
});

describe("clipboard source detection is a hint", () => {
  it("detects declared signals without requiring them for generic parsing", () => {
    expect(detectClipboardSource({ html: '<p style="mso-list:l0 level1 lfo1">x</p>' }).source).toBe("word");
    expect(detectClipboardSource({ html: '<div id="docs-internal-guid-1">x</div>' }).source).toBe("google-docs");
    expect(detectClipboardSource({ plainText: "# Heading" }).source).toBe("markdown");
    expect(parseClipboardPayload({ html: "<p>generic</p>" }, { ownerDocument: document }).document).toBeTruthy();
  });

  it("converts Office mso-list paragraphs into ordered and nested canonical lists", () => {
    const result = parseClipboardPayload({
      html: [
        '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>First</p>',
        '<p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">a.<span>&nbsp;</span></span>Nested</p>',
        '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;</span></span>Second</p>',
      ].join(""),
      plainText: "1. First\na. Nested\n2. Second",
    }, { ownerDocument: document });
    const serialized = JSON.stringify(result.document);
    expect(result.source).toBe("word");
    expect(result.document.children[0]).toMatchObject({ type: "list", attrs: { style: "decimal" } });
    expect(serialized.match(/"type":"list"/g)).toHaveLength(2);
    expect(serialized.match(/"type":"list_item"/g)).toHaveLength(3);
    expect(serialized).toContain("First");
    expect(serialized).toContain("Nested");
    expect(serialized).not.toMatch(/1\.|a\.|2\./);
  });
});

describe("native clipboard round-trip", () => {
  it("is lossless for 1,000 generated valid text documents (seed 0x8a2026)", () => {
    let seed = 0x8a2026;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let run = 0; run < 1_000; run += 1) {
      const children = Array.from({ length: 1 + random() % 8 }, (_, index) => ({
        type: "paragraph" as const,
        id: `p-${run}-${index}-${random()}`,
        children: [{
          type: "text" as const,
          text: `text-${random()}`,
          ...(random() % 2 ? { marks: [{ type: "bold" }] } : {}),
        }],
      }));
      const original: SmartDocument = { type: "doc", id: `doc-${run}-${random()}`, children };
      const copied = serializeClipboardRepresentations(original);
      expect(copied["text/html"]).not.toMatch(/data-smart-id|data-smart-ui/);
      const parsed = parseClipboardPayload({
        native: copied[NATIVE_CLIPBOARD_MIME],
        html: copied["text/html"],
        plainText: copied["text/plain"],
        types: [NATIVE_CLIPBOARD_MIME, "text/html", "text/plain"],
      }, { ownerDocument: document });
      expect(parsed.document).toEqual(original);
    }
  });
});
