// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEditorRuntime } from "../canonicalEditorRuntime.js";
import { ClassicEditor } from "./ClassicEditorAuthority.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("ClassicEditor legacy-compat onChange", () => {
  /**
   * Regression: onChange was typed as a union also accepting the new
   * canonical SmartEditorChange object, but always fired with that object
   * regardless of which shape the caller's function actually expected - a
   * real bug (a legacy caller expecting a string, e.g. Sootr's
   * RichTextEditor.tsx, silently got an object with no type error). Fixed
   * by wiring this prop to the existing debounced HTML serialization
   * (onHtmlChange) instead of the per-transaction onChange.
   */
  it("fires onChange with a plain HTML string, not a SmartEditorChange object", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    const changes = vi.fn();
    let runtime: CanonicalEditorRuntime | undefined;
    act(() => reactRoot.render(<StrictMode><ClassicEditor
      defaultValue="<p>start</p>"
      onChange={changes}
      onRuntime={(instance) => { runtime = instance; }}
    /></StrictMode>));

    act(() => runtime!.editor.typeText("!", { timestamp: 1 }));
    act(() => vi.advanceTimersByTime(300));

    expect(changes).toHaveBeenCalled();
    const [received] = changes.mock.calls.at(-1)!;
    expect(typeof received).toBe("string");
    expect(received).toContain("!start");
    // Never called with the structured per-transaction object this prop
    // used to leak through - would fail the string assertion above already,
    // but assert the negative explicitly for a clearer failure message.
    expect(received).not.toHaveProperty("revision");

    act(() => reactRoot.unmount());
  });

  /**
   * Sootr's RichTextEditor.tsx passes `table={enableTable}` straight
   * through to ClassicEditor (see docs/SOOTR_MIGRATION_READINESS.md gap
   * #3) - `table={false}` must select the "simple" capability preset
   * without Sootr needing to know the new preset name at all, so its five
   * existing call sites keep working with zero prop-shape changes beyond
   * what this migration already requires.
   */
  it("table={false} selects the 'simple' preset; an explicit preset prop wins over it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const reactRoot = createRoot(host);

    act(() => reactRoot.render(<ClassicEditor defaultValue="<p>hi</p>" table={false} />));
    expect(host.querySelector('[aria-label="Insert table"]')).toBeNull();

    act(() => reactRoot.render(<ClassicEditor defaultValue="<p>hi</p>" />));
    // Same runtime is retained (preset is construction-time-only, like
    // defaultValue) - re-render with table omitted doesn't retroactively
    // change it. Unmount and remount fresh to observe the default.
    act(() => reactRoot.unmount());
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const reactRoot2 = createRoot(host2);
    act(() => reactRoot2.render(<ClassicEditor defaultValue="<p>hi</p>" />));
    expect(host2.querySelector('[aria-label="Insert table"]')).not.toBeNull();

    const host3 = document.createElement("div");
    document.body.appendChild(host3);
    const reactRoot3 = createRoot(host3);
    act(() => reactRoot3.render(<ClassicEditor defaultValue="<p>hi</p>" table={false} preset="full" />));
    expect(host3.querySelector('[aria-label="Insert table"]')).not.toBeNull();

    act(() => reactRoot2.unmount());
    act(() => reactRoot3.unmount());
  });

  /**
   * docs/bugs/formula-not-rendered-in-static-html-consumers.md: the live
   * editing surface renders formulas via its own imperative katex.render()
   * calls, which onChange's serialized HTML string never captures on its
   * own - a host that displays this HTML directly (a read-only preview
   * built from saved content) saw an empty placeholder, no visible math.
   * `renderFormulaHtml` threads all the way from this legacy-compat prop
   * down through CanonicalAuthorityEditor and CanonicalEditorRuntime to
   * serializeCanonicalListHtml's own option (core-level rendering
   * correctness is covered directly in packages/core's own test suite).
   */
  it("renderFormulaHtml bakes real KaTeX HTML into onChange's output; off by default", () => {
    vi.useFakeTimers();
    const formulaHtml = '<p>x=<span data-smart-type="formula" data-smart-formula="E=mc^2" data-smart-notation="latex"></span></p>';

    const hostDefault = document.createElement("div");
    document.body.appendChild(hostDefault);
    const rootDefault = createRoot(hostDefault);
    const changesDefault = vi.fn();
    let runtimeDefault: CanonicalEditorRuntime | undefined;
    act(() => rootDefault.render(<ClassicEditor
      defaultValue={formulaHtml}
      onChange={changesDefault}
      onRuntime={(instance) => { runtimeDefault = instance; }}
    />));
    act(() => runtimeDefault!.editor.typeText("!", { timestamp: 1 }));
    act(() => vi.advanceTimersByTime(300));
    const [defaultHtml] = changesDefault.mock.calls.at(-1)!;
    expect(defaultHtml).not.toContain("katex");
    act(() => rootDefault.unmount());

    const hostRendered = document.createElement("div");
    document.body.appendChild(hostRendered);
    const rootRendered = createRoot(hostRendered);
    const changesRendered = vi.fn();
    let runtimeRendered: CanonicalEditorRuntime | undefined;
    act(() => rootRendered.render(<ClassicEditor
      defaultValue={formulaHtml}
      renderFormulaHtml
      onChange={changesRendered}
      onRuntime={(instance) => { runtimeRendered = instance; }}
    />));
    act(() => runtimeRendered!.editor.typeText("!", { timestamp: 1 }));
    act(() => vi.advanceTimersByTime(300));
    const [renderedHtml] = changesRendered.mock.calls.at(-1)!;
    expect(renderedHtml).toContain('class="katex"');
    expect(renderedHtml).toContain('data-smart-formula="E=mc^2"');
    act(() => rootRendered.unmount());
  });
});
