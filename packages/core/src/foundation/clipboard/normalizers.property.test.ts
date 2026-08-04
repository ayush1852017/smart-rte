// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeClipboardHtml } from "./sanitizer.js";
import { htmlClipboardNormalizer } from "./normalizers.js";

const normalize = (html: string) => htmlClipboardNormalizer.normalize(sanitizeClipboardHtml(document, "html", html, "")).html;

describe("clipboard normalizer algebra", () => {
  it("is deterministic and idempotent for 1,000 generated fragments (seed 0x8A11CE)", () => {
    let seed = 0x8A11CE;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let run = 0; run < 1_000; run += 1) {
      const value = random();
      const html = `<div><p data-run="${run}"><span${value % 3 === 0 ? ' style="font-weight:bold"' : ""}>text-${value}</span></p>${value % 5 === 0 ? `<x-safe-${run}>unknown-${value}</x-safe-${run}>` : ""}</div>`;
      const first = normalize(html);
      expect(normalize(html)).toBe(first);
      expect(normalize(first)).toBe(first);
    }
  });

  it("normalizes only the supplied detached fragment, never the live editor document", () => {
    const live = document.createElement("div");
    live.innerHTML = '<p id="live">untouched</p>';
    document.body.append(live);
    normalize("<div><p>clipboard</p></div>");
    expect(live.innerHTML).toBe('<p id="live">untouched</p>');
    live.remove();
  });
});
