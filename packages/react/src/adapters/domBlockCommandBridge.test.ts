// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeDomBlockCommand } from "./domBlockCommandBridge.js";

describe("DOM block command bridge", () => {
  it("changes only the selected sibling headings and preserves inline marks", () => {
    document.body.innerHTML = '<div><p>Before</p><p style="margin:2px"><strong>One</strong></p><p>Two</p><p>After</p></div>';
    const root = document.body.firstElementChild!;
    const selected = Array.from(root.children).slice(1, 3) as HTMLElement[];
    const replacements = executeDomBlockCommand(selected, {
      id: "block-type.set",
      input: { type: "heading", level: 3 },
    });
    expect(replacements?.map((node) => node.tagName)).toEqual(["H3", "H3"]);
    expect(root.firstElementChild?.textContent).toBe("Before");
    expect(root.lastElementChild?.textContent).toBe("After");
    expect(root.querySelector("h3 strong")?.textContent).toBe("One");
    expect((root.children[1] as HTMLElement).style.margin).toBe("2px");
  });

  it("applies alignment without discarding existing styles", () => {
    document.body.innerHTML = '<div><p style="color:red">One</p><p>Two</p></div>';
    const blocks = Array.from(document.querySelector("div")!.children) as HTMLElement[];
    executeDomBlockCommand(blocks, {
      id: "alignment.set",
      input: { alignment: "center" },
    });
    expect(blocks[0].isConnected).toBe(true);
    const first = document.querySelector("p") as HTMLElement;
    expect(first.style.color).toBe("red");
    expect(first.style.textAlign).toBe("center");
  });

  it("wraps and unwraps a localized blockquote", () => {
    document.body.innerHTML = "<div><p>One</p><p>Two</p><p>After</p></div>";
    const root = document.querySelector("div")!;
    executeDomBlockCommand(Array.from(root.children).slice(0, 2) as HTMLElement[], {
      id: "blockquote.toggle",
    });
    const quote = root.querySelector("blockquote") as HTMLElement;
    expect(quote.querySelectorAll(":scope > p")).toHaveLength(2);
    executeDomBlockCommand([quote], { id: "blockquote.toggle" });
    expect(root.querySelector("blockquote")).toBeNull();
    expect(Array.from(root.children).map((node) => node.textContent)).toEqual(["One", "Two", "After"]);
  });

  it("declines non-contiguous selections", () => {
    document.body.innerHTML = "<div><p>One</p><p>Middle</p><p>Three</p></div>";
    const children = Array.from(document.querySelector("div")!.children) as HTMLElement[];
    expect(executeDomBlockCommand([children[0], children[2]], { id: "code-block.toggle" })).toBeNull();
  });

  it("preserves block identity and marks across paragraph/heading toggles", () => {
    document.body.innerHTML = '<div><p data-smart-id="stable"><strong>Marked</strong></p></div>';
    const root = document.querySelector("div")!;
    const result = executeDomBlockCommand([root.firstElementChild as HTMLElement], {
      id: "block-type.set", input: { type: "heading", level: 4 },
    });
    expect(result?.[0]).toMatchObject({ tagName: "H4" });
    expect(result?.[0].dataset.smartId).toBe("stable");
    expect(result?.[0].querySelector("strong")?.textContent).toBe("Marked");
  });

  it("wraps a complete list shell in one quote rather than individual items", () => {
    document.body.innerHTML = '<div><ul><li><p>One</p></li><li><p>Two</p></li></ul><p>After</p></div>';
    const root = document.querySelector("div")!;
    executeDomBlockCommand([root.firstElementChild as HTMLElement], { id: "blockquote.toggle" });
    expect(root.querySelectorAll(":scope > blockquote")).toHaveLength(1);
    expect(root.querySelectorAll(":scope > blockquote > ul > li")).toHaveLength(2);
  });

  it("shares canonical movement and attribute indentation across block tools", () => {
    document.body.innerHTML = '<div><p data-smart-id="a">A</p><p data-smart-id="b">B</p></div>';
    const root = document.querySelector("div")!;
    let block = root.firstElementChild as HTMLElement;
    expect(executeDomBlockCommand([block], { id: "block.move", input: { direction: "down" } })).not.toBeNull();
    expect(Array.from(root.children).map((node) => node.textContent)).toEqual(["B", "A"]);
    block = root.lastElementChild as HTMLElement;
    expect(executeDomBlockCommand([block], { id: "block.indent" })?.[0]).toBe(block);
    expect(block.dataset.smartIndent).toBe("1");
    expect(block.style.marginInlineStart).toBe("2em");
  });

  it("strips marks when entering a code block and emits pre/code semantics", () => {
    document.body.innerHTML = '<div><p><strong>const x = 1;</strong></p></div>';
    const root = document.querySelector("div")!;
    const result = executeDomBlockCommand([root.firstElementChild as HTMLElement], { id: "code-block.toggle" });
    expect(result?.[0].tagName).toBe("PRE");
    expect(result?.[0].querySelector("code")?.textContent).toBe("const x = 1;");
    expect(result?.[0].querySelector("strong")).toBeNull();
  });

  it.each(["blockquote.toggle", "code-block.toggle"] as const)("preserves reverse native selection through %s", (id) => {
    document.body.innerHTML = '<div><p>First text</p><p>Second text</p></div>';
    const root = document.querySelector("div")!;
    const first = root.firstElementChild!.firstChild!;
    const second = root.lastElementChild!.firstChild!;
    document.getSelection()?.setBaseAndExtent(second, 4, first, 2);
    executeDomBlockCommand(Array.from(root.children) as HTMLElement[], { id });
    const selection = document.getSelection()!;
    expect(selection.anchorNode?.textContent).toBe("Second text");
    expect(selection.anchorOffset).toBe(4);
    expect(selection.focusNode?.textContent).toBe("First text");
    expect(selection.focusOffset).toBe(2);
  });
});
