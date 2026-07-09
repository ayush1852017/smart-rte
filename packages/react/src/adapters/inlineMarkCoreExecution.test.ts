// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getCoreInlineMarkResult, isCoreInlineMarkEnabled, type CoreInlineMark } from "./inlineMarkCoreExecution.js";
import { restoreSelectionToDom } from "./domSelectionBridge.js";
import type { SmartRteInternalFlags } from "./internalFlags.js";

type SmartRteFlagGlobal = typeof globalThis & {
  __SMART_RTE_INTERNAL_FLAGS__?: SmartRteInternalFlags;
  __SMART_RTE_CORE_ITALIC__?: boolean;
};

const flagGlobal = globalThis as SmartRteFlagGlobal;

const clearFlags = () => {
  delete flagGlobal.__SMART_RTE_INTERNAL_FLAGS__;
  delete flagGlobal.__SMART_RTE_CORE_ITALIC__;
};

const select = (editor: HTMLElement) => {
  const text = editor.querySelector("a")?.firstChild || editor.querySelector("p")?.firstChild!;
  const range = document.createRange();
  range.setStart(text, 1);
  range.setEnd(text, Math.min(3, text.textContent!.length));
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

describe("core inline mark execution", () => {
  afterEach(clearFlags);

  it.each(["italic", "underline", "superscript", "subscript"] as CoreInlineMark[])("keeps %s disabled by default", (mark) => {
    clearFlags();
    expect(isCoreInlineMarkEnabled(mark)).toBe(false);
  });

  it("uses the grouped internal flag without requiring old globals", () => {
    flagGlobal.__SMART_RTE_INTERNAL_FLAGS__ = { coreInlineMarks: true };

    expect(isCoreInlineMarkEnabled("italic")).toBe(true);
    expect(isCoreInlineMarkEnabled("underline")).toBe(true);
    expect(isCoreInlineMarkEnabled("superscript")).toBe(true);
    expect(isCoreInlineMarkEnabled("subscript")).toBe(true);
  });

  it("keeps old internal globals working for compatibility", () => {
    flagGlobal.__SMART_RTE_CORE_ITALIC__ = true;

    expect(isCoreInlineMarkEnabled("italic")).toBe(true);
    expect(isCoreInlineMarkEnabled("underline")).toBe(false);
  });

  it.each([
    ["italic", "em"],
    ["underline", "u"],
    ["superscript", "sup"],
    ["subscript", "sub"],
  ] as const)("executes %s only for its selected content and restores selection", (mark, tag) => {
    document.body.innerHTML = '<div id="editor"><blockquote><p>quote <a href="https://example.test">link</a></p></blockquote><div data-table-wrapper="true"><table><tbody><tr><td><p>cell</p></td></tr></tbody></table></div></div>';
    const editor = document.getElementById("editor") as HTMLElement;
    select(editor);
    const result = getCoreInlineMarkResult(editor, mark)!;
    expect(result.html).toContain(`<${tag}>`);
    expect(result.html).toContain('href="https://example.test"');
    expect(result.html).toContain("<td><p>cell</p></td>");
    expect(result.html).not.toContain("data-table-wrapper");
    editor.innerHTML = result.html;
    expect(restoreSelectionToDom(editor, result.selectionAfter)).toBe(true);
  });
});
