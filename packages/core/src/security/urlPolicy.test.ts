import { describe, expect, it } from "vitest";
import { normalizeLinkInput, sanitizeLinkHref } from "./urlPolicy.js";

describe("link normalization policy", () => {
  it.each([
    ["xyz@gmail.com", "email", "mailto:xyz@gmail.com"],
    ["mailto:xyz@gmail.com", "email", "mailto:xyz@gmail.com"],
    ["+91 98765 43210", "phone", "tel:+919876543210"],
    ["tel:+91 98765 43210", "phone", "tel:+919876543210"],
    ["example.com", "url", "https://example.com"],
    ["www.example.com", "url", "https://www.example.com"],
    ["https://example.com", "url", "https://example.com"],
    ["http://example.com", "url", "http://example.com"],
    [" #section-1 ", "anchor", "#section-1"],
    ["  https://example.com/path?q=1  ", "url", "https://example.com/path?q=1"],
  ])("normalizes %s as %s", (input, kind, href) => {
    expect(normalizeLinkInput(input)).toEqual({ kind, href, input: input.trim() });
    expect(sanitizeLinkHref(input)).toBe(href);
  });

  it.each([
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "relative/path",
    "not a link",
    "mailto:not-email",
    "tel:123",
  ])("rejects unsafe or invalid input %s", (input) => {
    expect(normalizeLinkInput(input).kind).toBe("invalid");
    expect(sanitizeLinkHref(input)).toBeNull();
  });
});
