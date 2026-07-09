// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { closestFromTarget, isElement, isNode } from "./domTargets.js";

describe("event target guards", () => {
  it("rejects null and text-node related targets", () => {
    const text = document.createTextNode("text");
    expect(isElement(null)).toBe(false);
    expect(isElement(text)).toBe(false);
    expect(isNode(text)).toBe(true);
    expect(closestFromTarget(null, "[data-srte-drag-handle]")).toBeNull();
    expect(closestFromTarget(text, "[data-srte-drag-handle]")).toBeNull();
  });

  it("rejects document and window-like non-elements", () => {
    expect(isElement(document)).toBe(false);
    expect(isElement(window)).toBe(false);
    expect(closestFromTarget(document, "[data-srte-drag-handle]")).toBeNull();
    expect(closestFromTarget(window, "[data-srte-drag-handle]")).toBeNull();
  });

  it("resolves a valid drag-handle element without touching surrounding table UI", () => {
    document.body.innerHTML = '<div data-table-wrapper="true"><div data-srte-context-menu="true"></div><button data-srte-drag-handle="true"><span>Move</span></button></div>';
    const target = document.querySelector("span")!;
    expect(closestFromTarget(target, "[data-srte-drag-handle]")).toBe(document.querySelector("button"));
  });
});
