// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SmartDocument, SmartSelection } from "../types.js";
import { FoundationSubtreeRenderer } from "./renderer.js";

const noneSelection: SmartSelection = { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };

const codeDoc = (text: string): SmartDocument => ({
  type: "doc", id: "doc",
  children: [{ type: "code_block", id: "code", attrs: { language: "ts" }, children: text ? [{ type: "text", text }] : [] }],
});

/**
 * Regression (2026-09-12, live report): "single enter not adding new line."
 * A code block stores line breaks as literal "\n" characters in its text
 * (unlike a paragraph's explicit hard_break nodes), and a trailing "\n" with
 * nothing rendered after it takes up zero extra height under
 * white-space:pre-wrap - there's no following content for the browser to
 * anchor a new line box against. The model was correct (confirmed via a
 * document dump: the "\n" really was there), but the box never grew, so
 * pressing Enter at the end of a code block looked like nothing happened.
 */
describe("code block trailing-newline projection", () => {
  it("projects a renderer-only <br> after a trailing newline, on first render", () => {
    const root = window.document.createElement("div");
    new FoundationSubtreeRenderer(root).render(codeDoc("abc\n"), noneSelection);
    const pre = root.querySelector("pre")!;
    expect(pre.querySelector("br[data-smart-trailing-newline]")).not.toBeNull();
    expect(pre.textContent).toBe("abc\n");
  });

  it("does not project when the text does not end in a newline", () => {
    const root = window.document.createElement("div");
    new FoundationSubtreeRenderer(root).render(codeDoc("abc"), noneSelection);
    expect(root.querySelector("pre")!.querySelector("br[data-smart-trailing-newline]")).toBeNull();
  });

  it("adds the projection on a diff-update once a newline is appended, and removes it once typed over", () => {
    const root = window.document.createElement("div");
    const renderer = new FoundationSubtreeRenderer(root);
    renderer.render(codeDoc("abc"), noneSelection);
    expect(root.querySelector("pre")!.querySelector("br[data-smart-trailing-newline]")).toBeNull();

    renderer.render(codeDoc("abc\n"), noneSelection);
    expect(root.querySelector("pre")!.querySelector("br[data-smart-trailing-newline]")).not.toBeNull();

    renderer.render(codeDoc("abc\nd"), noneSelection);
    expect(root.querySelector("pre")!.querySelector("br[data-smart-trailing-newline]")).toBeNull();
    expect(root.querySelector("pre")!.textContent).toBe("abc\nd");
  });

  it("never projects for an ordinary paragraph, even with a literal newline character in its text", () => {
    const root = window.document.createElement("div");
    const doc: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "abc\n" }] }] };
    new FoundationSubtreeRenderer(root).render(doc, noneSelection);
    expect(root.querySelector("p")!.querySelector("br[data-smart-trailing-newline]")).toBeNull();
  });
});
