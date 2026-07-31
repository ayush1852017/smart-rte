// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { checklistPlugin, formulaPlugin, listPlugin } from "smartrte-core";
import { executeDomCommand } from "./domCommandBridge.js";

const select = (start: Text, startOffset: number, end: Text, endOffset: number) => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

describe("DOM command bridge", () => {
  it("changes the containing list type and preserves its nested subtree", () => {
    document.body.innerHTML = `
      <div id="editor">
        <p>Heading</p>
        <ul>
          <li><p>Parent</p><ul><li><p>Child one</p></li><li><p>Child two</p></li></ul></li>
          <li><p>Sibling</p></li>
        </ul>
      </div>`;
    const root = document.getElementById("editor") as HTMLElement;
    const parent = root.querySelector("li p")!.firstChild as Text;
    const child = root.querySelector("li ul li p")!.firstChild as Text;

    const result = executeDomCommand({
      root,
      plugins: [listPlugin],
      commandId: "list.toggle",
      input: { style: "decimal", cascadeStyles: true },
      selection: select(parent, 0, child, child.data.length),
    });

    expect(result).not.toBeNull();
    expect(root.querySelector(":scope > ol")).not.toBeNull();
    expect(root.querySelectorAll(":scope > ol > li")).toHaveLength(2);
    expect(root.querySelector(':scope > ol > li ol[style*="lower-alpha"]')).not.toBeNull();
    expect(root.textContent).toContain("Child two");
    expect(root.textContent).toContain("Sibling");
  });

  it("toggles an existing ordered list off without losing its items", () => {
    document.body.innerHTML = '<div id="editor"><ol><li><p>A</p></li><li><p>B</p></li></ol></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const first = root.querySelector("li p")!.firstChild as Text;
    const last = root.querySelectorAll("li p")[1].firstChild as Text;

    executeDomCommand({
      root,
      plugins: [listPlugin],
      commandId: "list.toggle",
      input: { style: "decimal" },
      selection: select(first, 0, last, 1),
    });

    expect(root.querySelector("ol")).toBeNull();
    expect(Array.from(root.querySelectorAll(":scope > p")).map((node) => node.textContent))
      .toEqual(["A", "B"]);
  });

  it("creates and removes a checklist through the same model bridge", () => {
    document.body.innerHTML = '<div id="editor"><p>A</p><p>B</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const first = root.querySelector("p")!.firstChild as Text;
    const last = root.querySelectorAll("p")[1].firstChild as Text;
    executeDomCommand({
      root,
      plugins: [listPlugin, checklistPlugin],
      commandId: "checklist.toggle",
      input: { strikeCompleted: true },
      selection: select(first, 0, last, 1),
    });
    expect(root.querySelector('[data-srte-checklist="true"]')).not.toBeNull();
    expect(root.querySelectorAll("[data-srte-checked='false']")).toHaveLength(2);

    const listFirst = root.querySelector("li p")!.firstChild as Text;
    const listLast = root.querySelectorAll("li p")[1].firstChild as Text;
    executeDomCommand({
      root,
      plugins: [listPlugin, checklistPlugin],
      commandId: "checklist.toggle",
      selection: select(listFirst, 0, listLast, 1),
    });
    expect(root.querySelector("[data-srte-checklist]")).toBeNull();
    expect(root.querySelector("ul")).not.toBeNull();
  });

  it("inserts a formula at a collapsed model selection", () => {
    document.body.innerHTML = '<div id="editor"><p>ab</p></div>';
    const root = document.getElementById("editor") as HTMLElement;
    const text = root.querySelector("p")!.firstChild as Text;
    executeDomCommand({
      root,
      plugins: [formulaPlugin],
      commandId: "formula.insert",
      input: { value: "x^2", displayText: "x²" },
      selection: select(text, 1, text, 1),
    });
    expect(root.innerHTML).toContain('data-formula="x^2"');
    expect(root.textContent).toBe("ax²b");
  });
});
