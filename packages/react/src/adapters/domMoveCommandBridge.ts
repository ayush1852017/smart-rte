import { createSmartEditor, movePlugin } from "smartrte-core";
import { smartDocumentFromHtml } from "./domSmartDocument.js";

export type DomMoveDirection = "up" | "down" | "left" | "right";

/**
 * Executes model move/indent commands while preserving the existing DOM nodes.
 * Null means the DOM shape is outside this adapter; false means a valid command
 * was disabled at a boundary.
 */
export const executeDomMoveCommand = (
  blocks: readonly HTMLElement[],
  direction: DomMoveDirection,
  beforeMutation?: () => void,
): HTMLElement[] | false | null => {
  if (!blocks.length || !blocks[0].parentElement) return null;
  const parent = blocks[0].parentElement;
  if (!blocks.every((block) => block.parentElement === parent)) return null;
  const siblings = Array.from(parent.children) as HTMLElement[];
  const indexes = blocks.map((block) => siblings.indexOf(block));
  if (indexes.some((index, position) => index < 0 || (position > 0 && index !== indexes[position - 1] + 1))) {
    return null;
  }
  const document = smartDocumentFromHtml(siblings.map((sibling) => sibling.outerHTML).join(""), parent.ownerDocument);
  if (document.children.length !== siblings.length) return null;
  const editor = createSmartEditor({
    state: { document, selection: { type: "all" } },
    plugins: [movePlugin],
  });
  const commandId = direction === "up" || direction === "down" ? "block.move" : "block.indent";
  const input = {
    parentPath: [],
    blockIndexes: indexes,
    direction: direction === "left" ? "outdent" : direction === "right" ? "indent" : direction,
  };
  if (!editor.execute(commandId, input)) return false;
  beforeMutation?.();

  if (direction === "left" || direction === "right") {
    indexes.forEach((index, position) => {
      const indent = editor.state.document.children[index].indent || 0;
      blocks[position].style.marginLeft = indent ? `${indent * 24}px` : "";
      if (!blocks[position].getAttribute("style")) blocks[position].removeAttribute("style");
    });
    return [...blocks];
  }
  if (direction === "up") {
    const previous = siblings[indexes[0] - 1];
    blocks.forEach((block) => parent.insertBefore(block, previous));
  } else {
    const next = siblings[indexes[indexes.length - 1] + 1];
    const reference = next.nextSibling;
    blocks.forEach((block) => parent.insertBefore(block, reference));
  }
  return [...blocks];
};
