// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { basicFormattingPlugin, tablePlugin } from "smartrte-core";
import { createDomEditorController } from "./editorController.js";

const rootWithSelection = () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>Hello</p>";
  document.body.appendChild(root);
  const text = root.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return root;
};

describe("DOM editor controller", () => {
  it("exposes canonical snapshots and serialization", () => {
    const root = rootWithSelection();
    const controller = createDomEditorController().bindRoot(root);
    expect(controller.snapshot()).toMatchObject({
      document: { type: "doc" },
      selection: { anchor: { path: [0, 0], offset: 0 } },
      html: "<p>Hello</p>",
    });
  });

  it("executes plugin commands and emits canonical changes", () => {
    const root = rootWithSelection();
    const listener = vi.fn();
    const controller = createDomEditorController()
      .bindRoot(root)
      .configure({ plugins: [basicFormattingPlugin] });
    controller.subscribe(listener);

    expect(controller.execute("toggle-bold")).not.toBeNull();
    expect(root.innerHTML).toContain("<strong>Hello</strong>");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "toggle-bold",
      snapshot: expect.objectContaining({ html: expect.stringContaining("<strong>Hello</strong>") }),
    }));
  });

  it("blocks commands and replacement in read-only mode", () => {
    const root = rootWithSelection();
    const controller = createDomEditorController()
      .bindRoot(root)
      .configure({ plugins: [basicFormattingPlugin], readOnly: true });
    expect(controller.execute("toggle-bold")).toBeNull();
    expect(controller.replaceDocument({ type: "doc", children: [] })).toBe(false);
    expect(root.innerHTML).toBe("<p>Hello</p>");
  });

  it("executes localized structural commands without replacing surrounding blocks", () => {
    document.body.innerHTML = '<div id="editor"><p>Before</p><p style="color:red"><strong>One</strong></p><p>Two</p><p>After</p></div>';
    const root = document.getElementById("editor")!;
    const selected = Array.from(root.children).slice(1, 3) as HTMLElement[];
    const listener = vi.fn();
    const controller = createDomEditorController().bindRoot(root);
    controller.subscribe(listener);

    const replacements = controller.executeBlockCommand(selected, {
      id: "block-type.set",
      input: { type: "heading", level: 2 },
    });

    expect(replacements?.map((block) => block.tagName)).toEqual(["H2", "H2"]);
    expect(Array.from(root.children).map((block) => block.textContent))
      .toEqual(["Before", "One", "Two", "After"]);
    expect((root.children[1] as HTMLElement).style.color).toBe("red");
    expect(root.querySelector("h2 strong")?.textContent).toBe("One");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "block-type.set",
    }));
  });

  it("updates checklist item state without replacing its DOM identity", () => {
    document.body.innerHTML = `
      <div id="editor">
        <ul data-srte-checklist="true"><li data-checked="false"><p>Task</p></li></ul>
      </div>`;
    const root = document.getElementById("editor")!;
    const list = root.querySelector("ul")!;
    const item = root.querySelector("li")!;
    const listener = vi.fn();
    const controller = createDomEditorController().bindRoot(root);
    controller.subscribe(listener);

    expect(controller.executeChecklistItemCommand(list, item, true)).toBe(list);
    expect(root.querySelector("li")).toBe(item);
    expect(item.dataset.checked).toBe("true");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "checklist.set-checked",
    }));
  });

  it("executes table merge and split through a localized table boundary", () => {
    document.body.innerHTML = `
      <div id="editor"><p>Before</p><table style="width:80%"><tbody>
        <tr><td style="background:red"><p>A</p></td><td><p>B</p></td></tr>
        <tr><td><p>C</p></td><td><p>D</p></td></tr>
      </tbody></table><p>After</p></div>`;
    const root = document.getElementById("editor")!;
    const controller = createDomEditorController().bindRoot(root);
    const mergedTable = controller.executeTableCommand(root.querySelector("table")!, {
      id: "table.cell.merge",
      input: { start: { row: 0, column: 0 }, end: { row: 1, column: 1 } },
    });
    const mergedCell = mergedTable!.querySelector("td")!;
    expect(mergedCell.colSpan).toBe(2);
    expect(mergedCell.rowSpan).toBe(2);
    expect(mergedCell.style.background).toBe("red");
    expect(root.firstElementChild?.textContent).toBe("Before");
    expect(root.lastElementChild?.textContent).toBe("After");

    const splitTable = controller.executeTableCommand(mergedTable!, {
      id: "table.cell.split",
      input: { row: 0, column: 0 },
    });
    expect(splitTable?.rows[0].cells).toHaveLength(2);
    expect(splitTable?.rows[1].cells).toHaveLength(2);
    expect(splitTable?.rows[0].cells[0].textContent).toBe("ABCD");
  });

  it("removes tables through the controller and emits a canonical change", () => {
    document.body.innerHTML = `
      <div id="editor"><p>Before</p><table><tbody><tr><td><p>A</p></td></tr></tbody></table><p>After</p></div>`;
    const root = document.getElementById("editor")!;
    const listener = vi.fn();
    const controller = createDomEditorController().bindRoot(root);
    controller.subscribe(listener);

    expect(controller.removeTable(root.querySelector("table")!)).toBe(true);
    expect(root.querySelector("table")).toBeNull();
    expect(root.textContent).toBe("BeforeAfter");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "table.remove",
    }));
  });

  it("inserts a table at a canonical block boundary", () => {
    const root = rootWithSelection();
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const controller = createDomEditorController()
      .bindRoot(root)
      .configure({ plugins: [tablePlugin] });

    const table = controller.insertTable(2, 3, true);
    expect(table?.rows).toHaveLength(2);
    expect(table?.rows[0].cells).toHaveLength(3);
    expect(table?.rows[0].cells[0].tagName).toBe("TH");
    expect(root.firstElementChild?.textContent).toBe("Hello");
    expect(root.lastElementChild).toBe(table);
  });

  it("owns localized image and formula mutations and emits changes", () => {
    const root = rootWithSelection();
    const listener = vi.fn();
    const controller = createDomEditorController().bindRoot(root);
    controller.subscribe(listener);

    const initialText = root.querySelector("p")!.firstChild!;
    const initialRange = document.createRange();
    initialRange.setStart(initialText, 5);
    initialRange.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(initialRange);
    const image = controller.insertInlineImage({ src: "/image.png", alt: "Example" });
    expect(image?.alt).toBe("Example");
    expect(controller.updateInlineImage(image!, { width: 120 })).toBe(true);
    expect(image?.width).toBe(120);
    expect(controller.deleteInlineAtom(image!)).toBe(true);

    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const formula = controller.insertFormula({ value: "x^2", displayText: "$x^2$" });
    expect(formula?.dataset.formula).toBe("x^2");
    expect(controller.deleteInlineAtom(formula!)).toBe(true);
    expect(listener.mock.calls.map(([change]) => change.commandId)).toEqual([
      "image.insert-inline",
      "image.update-inline",
      "image.delete-inline",
      "formula.insert",
      "formula.delete",
    ]);
  });

  it("owns DOM snapshot undo and redo history", () => {
    const root = rootWithSelection();
    const controller = createDomEditorController().bindRoot(root);
    expect(controller.recordHistorySnapshot()).toBe(true);
    root.innerHTML = "<p>Changed</p>";

    expect(controller.restoreHistory("undo")?.html).toBe("<p>Hello</p>");
    expect(root.innerHTML).toBe("<p>Hello</p>");
    expect(controller.restoreHistory("redo")?.html).toBe("<p>Changed</p>");
    expect(root.innerHTML).toBe("<p>Changed</p>");
  });

  it("deduplicates and can discard speculative history snapshots", () => {
    const root = rootWithSelection();
    const controller = createDomEditorController().bindRoot(root);
    expect(controller.recordHistorySnapshot("<p>Before</p>")).toBe(true);
    expect(controller.recordHistorySnapshot("<p>Before</p>")).toBe(false);
    expect(controller.discardLastHistorySnapshot("<p>Other</p>")).toBe(false);
    expect(controller.discardLastHistorySnapshot("<p>Before</p>")).toBe(true);
    root.innerHTML = "<p>After</p>";
    expect(controller.restoreHistory("undo")).toBeNull();
  });

  it("upgrades command-backed snapshots into a hybrid canonical history entry", () => {
    const root = rootWithSelection();
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const controller = createDomEditorController().bindRoot(root);

    controller.recordHistorySnapshot();
    expect(controller.insertFormula({ value: "x", displayText: "$x$" })).not.toBeNull();
    expect(controller.historyStatus()).toMatchObject({
      undo: 1,
      canonicalUndo: 1,
    });
    expect(controller.restoreHistory("undo")?.canonical).toBeDefined();
    expect(root.innerHTML).toBe("<p>Hello</p>");
    expect(controller.restoreHistory("redo")?.canonical).toBeDefined();
    expect(root.querySelector("[data-formula]")?.textContent).toBe("$x$");
  });
});
