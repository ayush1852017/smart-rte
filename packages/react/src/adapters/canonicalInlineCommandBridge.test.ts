// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalInlineStoredMarks,
  executeCanonicalInlineTool,
  installCanonicalInlineStoredMarkInput,
  type CanonicalInlineToolId,
} from "./canonicalInlineCommandBridge.js";

const roots: HTMLElement[] = [];
const rootOf = (html: string) => {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.appendChild(root);
  roots.push(root);
  return root;
};

const select = (root: HTMLElement, start: [Node, number], end: [Node, number] = start) => {
  const native = root.ownerDocument.getSelection()!;
  native.setBaseAndExtent(start[0], start[1], end[0], end[1]);
};

afterEach(() => {
  roots.forEach((root) => root.remove());
  roots.length = 0;
  document.getSelection()?.removeAllRanges();
});

describe("canonical inline DOM migration adapter", () => {
  it.each([
    ["bold", "strong", undefined], ["italic", "em", undefined], ["underline", "u", undefined],
    ["strikethrough", "s", undefined], ["inlineCode", "code", undefined], ["superscript", "sup", undefined],
    ["subscript", "sub", undefined], ["textColor", "span", { value: "red" }],
    ["backgroundColor", "span", { value: "#00ff00" }], ["fontSize", "span", { valuePx: 16 }],
    ["fontFamily", "span", { value: "Inter" }], ["link", "a", { href: "https://example.com" }],
  ] as Array<[CanonicalInlineToolId, string, Record<string, unknown> | undefined]>)
  ("routes %s through the one generic mark engine", (tool, tag, attrs) => {
    const root = rootOf('<p data-smart-id="p">hello</p>');
    const text = root.querySelector("p")!.firstChild!;
    select(root, [text, 1], [text, 4]);
    const result = executeCanonicalInlineTool(root, tool, "apply", attrs);
    expect(result.changed).toBe(true);
    expect(root.querySelector(tag)?.textContent).toBe("ell");
  });

  it("uses one multi-owner scope through list items and table cells", () => {
    const list = rootOf('<ul><li><p data-smart-id="a">one</p></li><li><p data-smart-id="b">two</p></li></ul>');
    const first = list.querySelector('[data-smart-id="a"]')!.firstChild!;
    const second = list.querySelector('[data-smart-id="b"]')!.firstChild!;
    select(list, [first, 1], [second, 2]);
    expect(executeCanonicalInlineTool(list, "bold").changed).toBe(true);
    expect(list.querySelectorAll("strong")).toHaveLength(2);

    const table = rootOf('<table><tbody><tr><td><p data-smart-id="cell">cell</p></td></tr></tbody></table>');
    const cell = table.querySelector("p")!.firstChild!;
    select(table, [cell, 0], [cell, 4]);
    expect(executeCanonicalInlineTool(table, "italic").changed).toBe(true);
    expect(table.querySelector("td em")?.textContent).toBe("cell");
  });

  it("applies attributed marks across multiple top-level owners", () => {
    const root = rootOf('<p data-smart-id="a">one</p><p data-smart-id="b">two</p><p data-smart-id="c">three</p>');
    const owners = root.querySelectorAll("p");
    select(root, [owners[0].firstChild!, 1], [owners[2].firstChild!, 2]);
    expect(executeCanonicalInlineTool(root, "fontSize", "apply", { valuePx: 24 }).changed).toBe(true);
    expect(root.querySelectorAll('span[style*="font-size: 24px"]')).toHaveLength(3);
  });

  it("preserves reverse selection and consumes collapsed stored marks on input", () => {
    const root = rootOf('<p data-smart-id="p">hello</p>');
    const text = root.querySelector("p")!.firstChild!;
    select(root, [text, 4], [text, 1]);
    executeCanonicalInlineTool(root, "bold");
    expect(document.getSelection()?.anchorOffset).toBe(3);
    expect(document.getSelection()?.focusOffset).toBe(1);

    const tail = root.querySelector("p")!.lastChild!;
    select(root, [tail, tail.textContent?.length || 0]);
    executeCanonicalInlineTool(root, "italic");
    expect(canonicalInlineStoredMarks(root)).toEqual([{ type: "italic" }]);
    const uninstall = installCanonicalInlineStoredMarkInput(root);
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "x" });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(root.querySelector("em")?.textContent).toBe("x");
    uninstall();
  });

  it("edits and removes a whole link at a collapsed cursor", () => {
    const root = rootOf('<p data-smart-id="p">a<a href="https://old.example">link</a>z</p>');
    const text = root.querySelector("a")!.firstChild!;
    select(root, [text, 2]);
    expect(executeCanonicalInlineTool(root, "link", "editLink", { href: "https://new.example" }).changed).toBe(true);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://new.example");
    const editedText = root.querySelector("a")!.firstChild!;
    select(root, [editedText, 2]);
    expect(executeCanonicalInlineTool(root, "link", "remove").changed).toBe(true);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("alinkz");
  });
});
