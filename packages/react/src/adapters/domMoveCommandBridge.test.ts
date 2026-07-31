// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { executeDomMoveCommand } from "./domMoveCommandBridge.js";

const setup = () => {
  document.body.innerHTML = "<div><p>A</p><p>B</p><p>C</p><p>D</p></div>";
  const parent = document.body.firstElementChild!;
  return { parent, blocks: Array.from(parent.children) as HTMLElement[] };
};

describe("DOM move command bridge", () => {
  it("moves a selected run as one unit without replacing its nodes", () => {
    const { parent, blocks } = setup();
    const beforeMutation = vi.fn();
    expect(executeDomMoveCommand([blocks[1], blocks[2]], "up", beforeMutation)).toEqual([blocks[1], blocks[2]]);
    expect(Array.from(parent.children).map((node) => node.textContent)).toEqual(["B", "C", "A", "D"]);
    expect(parent.children[0]).toBe(blocks[1]);
    expect(beforeMutation).toHaveBeenCalledOnce();
  });

  it("moves a selected run down and refuses boundaries", () => {
    const { parent, blocks } = setup();
    expect(executeDomMoveCommand([blocks[1], blocks[2]], "down")).toBeTruthy();
    expect(Array.from(parent.children).map((node) => node.textContent)).toEqual(["A", "D", "B", "C"]);
    expect(executeDomMoveCommand([parent.lastElementChild as HTMLElement], "down")).toBe(false);
  });

  it("uses model indentation and preserves unrelated inline styles", () => {
    const { blocks } = setup();
    blocks[1].style.color = "red";
    expect(executeDomMoveCommand([blocks[1], blocks[2]], "right")).toBeTruthy();
    expect(blocks[1].style.marginLeft).toBe("24px");
    expect(blocks[2].style.marginLeft).toBe("24px");
    expect(blocks[1].style.color).toBe("red");
    expect(executeDomMoveCommand([blocks[1], blocks[2]], "left")).toBeTruthy();
    expect(blocks[1].style.marginLeft).toBe("");
  });
});
