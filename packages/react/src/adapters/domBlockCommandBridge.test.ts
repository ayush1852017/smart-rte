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
});
