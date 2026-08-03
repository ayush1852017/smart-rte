import {
  alignmentPlugin,
  blockquotePlugin,
  blockTypePlugin,
  codeBlockPlugin,
  createSmartEditor,
  type SetBlockTypeInput,
  type TextAlignment,
} from "smartrte-core/legacy";
import { serializeSmartDocument, smartDocumentFromHtml } from "./domSmartDocument.js";

export type DomBlockCommand =
  | { id: "block-type.set"; input: Pick<SetBlockTypeInput, "type" | "level"> }
  | { id: "alignment.set"; input: { alignment: TextAlignment | null } }
  | { id: "blockquote.toggle" }
  | { id: "code-block.toggle" };

const pluginFor = (id: DomBlockCommand["id"]) => {
  if (id === "block-type.set") return blockTypePlugin;
  if (id === "alignment.set") return alignmentPlugin;
  if (id === "blockquote.toggle") return blockquotePlugin;
  return codeBlockPlugin;
};

const isContiguousSiblingRun = (blocks: readonly HTMLElement[]) => {
  if (!blocks.length || !blocks[0].parentElement) return false;
  const parent = blocks[0].parentElement;
  if (!blocks.every((block) => block.parentElement === parent)) return false;
  const siblings = Array.from(parent.children);
  const indexes = blocks.map((block) => siblings.indexOf(block));
  return indexes.every((index, offset) => index >= 0 && (offset === 0 || index === indexes[offset - 1] + 1));
};

/**
 * Runs a core block command against a contiguous sibling run and replaces only
 * that run. Returns null when the DOM shape needs a more specialized adapter.
 */
export const executeDomBlockCommand = (
  blocks: readonly HTMLElement[],
  command: DomBlockCommand,
): HTMLElement[] | null => {
  if (!isContiguousSiblingRun(blocks)) return null;
  const ownerDocument = blocks[0].ownerDocument;
  const document = smartDocumentFromHtml(blocks.map((block) => block.outerHTML).join(""), ownerDocument);
  if (document.children.length !== blocks.length) return null;
  const indexes = document.children.map((_, index) => index);
  const editor = createSmartEditor({
    state: { document, selection: { type: "all" } },
    plugins: [pluginFor(command.id)],
  });
  const input = command.id === "alignment.set"
    ? { paths: indexes.map((index) => [index]), alignment: command.input.alignment }
    : command.id === "block-type.set"
      ? { parentPath: [], blockIndexes: indexes, ...command.input }
      : { parentPath: [], blockIndexes: indexes };
  if (!editor.execute(command.id, input)) return null;

  const container = ownerDocument.createElement("div");
  container.innerHTML = serializeSmartDocument(editor.state.document);
  const replacements = Array.from(container.children) as HTMLElement[];
  if (!replacements.length) return null;
  if (command.id === "alignment.set" && replacements.length === blocks.length) {
    replacements.forEach((replacement, index) => {
      blocks[index].style.textAlign = replacement.style.textAlign;
      if (!blocks[index].getAttribute("style")) blocks[index].removeAttribute("style");
    });
    return [...blocks];
  }
  const parent = blocks[0].parentElement!;
  const reference = blocks[0];
  replacements.forEach((replacement, index) => {
    if (replacements.length === blocks.length) {
      const previous = blocks[index];
      const generatedAlignment = replacement.style.textAlign;
      const previousStyle = previous.getAttribute("style");
      const previousClass = previous.getAttribute("class");
      if (previousStyle) replacement.setAttribute("style", previousStyle);
      if (generatedAlignment) replacement.style.textAlign = generatedAlignment;
      if (!replacement.getAttribute("style")) replacement.removeAttribute("style");
      if (previousClass) replacement.setAttribute("class", previousClass);
    }
    parent.insertBefore(replacement, reference);
  });
  blocks.forEach((block) => block.remove());
  return replacements;
};
