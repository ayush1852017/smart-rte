// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getCoreBoldResult, isCoreBoldEnabled } from "./coreBold.js";
import { restoreSelectionToDom } from "./domSelectionBridge.js";
import type { SmartRteInternalFlags } from "./internalFlags.js";

type SmartRteFlagGlobal = typeof globalThis & {
  __SMART_RTE_INTERNAL_FLAGS__?: SmartRteInternalFlags;
  __SMART_RTE_CORE_BOLD__?: boolean;
};

describe("core bold feature flag", () => {
  it("is disabled unless the internal flag is explicitly enabled", () => {
    delete (globalThis as SmartRteFlagGlobal).__SMART_RTE_INTERNAL_FLAGS__;
    delete (globalThis as SmartRteFlagGlobal).__SMART_RTE_CORE_BOLD__;
    expect(isCoreBoldEnabled()).toBe(false);
  });

  it("supports the preferred grouped internal flag", () => {
    (globalThis as SmartRteFlagGlobal).__SMART_RTE_INTERNAL_FLAGS__ = { coreInlineMarks: true };
    expect(isCoreBoldEnabled()).toBe(true);
    delete (globalThis as SmartRteFlagGlobal).__SMART_RTE_INTERNAL_FLAGS__;
  });

  it("bolds selected text only while preserving links and table-cell structure", () => {
    document.body.innerHTML = '<div id="editor"><p>before <a href="https://example.test">linked</a> after</p><div data-table-wrapper="true"><table><tbody><tr><td><p>cell text</p></td></tr></tbody></table></div></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const text = editor.querySelector("a")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const result = getCoreBoldResult(editor)!;
    expect(result.html).toContain('<strong><a href="https://example.test">inke</a></strong>');
    expect(result.html).toContain("<td><p>cell text</p></td>");
    expect(result.html).not.toContain("data-table-wrapper");
  });

  it("skips unsupported cross-block selections", () => {
    document.body.innerHTML = '<div id="editor"><p>one</p><p>two</p></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const range = document.createRange();
    range.setStart(editor.querySelectorAll("p")[0].firstChild!, 0);
    range.setEnd(editor.querySelectorAll("p")[1].firstChild!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(getCoreBoldResult(editor)).toBeNull();
  });

  it("restores a multi-node selection inside a table-cell paragraph", () => {
    document.body.innerHTML = '<div id="editor"><div data-table-wrapper="true"><table><tbody><tr><td><p>cell <a href="https://example.test">link</a></p></td></tr></tbody></table></div></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    const start = editor.querySelector("td p")!.firstChild!;
    const end = editor.querySelector("a")!.firstChild!;
    const range = document.createRange();
    range.setStart(start, 2);
    range.setEnd(end, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const result = getCoreBoldResult(editor)!;
    editor.innerHTML = result.html;

    expect(restoreSelectionToDom(editor, result.selectionAfter)).toBe(true);
    const restored = window.getSelection()!;
    expect(restored.toString()).toBe("ll lin");
    expect(editor.querySelector("a")?.getAttribute("href")).toBe("https://example.test");
  });
});
