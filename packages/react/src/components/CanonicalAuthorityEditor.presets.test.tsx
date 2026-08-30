// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CanonicalAuthorityEditor } from "./CanonicalAuthorityEditor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The toolbar is hand-authored JSX, not driven by the plugin registry's own
 * toolbar contributions the way the context menu already is (see
 * CanonicalAuthorityEditor.tsx's `tablesEnabled` doc comment) - this
 * verifies the toolbar-level gating specifically, since capabilityPresets.
 * test.ts already covers the schema/round-trip-safety side without ever
 * rendering a real toolbar.
 */
describe("CanonicalAuthorityEditor: preset-driven toolbar gating", () => {
  it("hides the table toolbar group entirely under the 'simple' preset", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CanonicalAuthorityEditor defaultValue="<p>hi</p>" preset="simple" />));

    expect(host.querySelector('[aria-label="Insert table"]')).toBeNull();
    expect(Array.from(host.querySelectorAll("summary")).some((el) => el.textContent?.includes("Table tools"))).toBe(false);

    act(() => root.unmount());
  });

  it("shows the table toolbar group under the default ('full') preset", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CanonicalAuthorityEditor defaultValue="<p>hi</p>" />));

    expect(host.querySelector('[aria-label="Insert table"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll("summary")).some((el) => el.textContent?.includes("Table tools"))).toBe(true);

    act(() => root.unmount());
  });
});
