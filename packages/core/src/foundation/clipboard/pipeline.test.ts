// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseClipboardPayload } from "./pipeline.js";
import { detectClipboardSource } from "./detection.js";
import type { SourceNormalizer } from "./types.js";

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
});

describe("clipboard source detection is a hint", () => {
  it("detects declared signals without requiring them for generic parsing", () => {
    expect(detectClipboardSource({ html: '<p style="mso-list:l0 level1 lfo1">x</p>' }).source).toBe("word");
    expect(detectClipboardSource({ html: '<div id="docs-internal-guid-1">x</div>' }).source).toBe("google-docs");
    expect(detectClipboardSource({ plainText: "# Heading" }).source).toBe("markdown");
    expect(parseClipboardPayload({ html: "<p>generic</p>" }, { ownerDocument: document }).document).toBeTruthy();
  });
});
