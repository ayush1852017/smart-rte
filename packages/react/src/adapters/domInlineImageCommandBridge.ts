import {
  createSmartEditor,
  getNodeAtPath,
  mediaPlugin,
  type SmartInlineImageNode,
} from "smartrte-core";
import { selectionFromDom } from "./domSelectionBridge.js";
import { smartDocumentFromEditorRoot } from "./domSmartDocument.js";
import { inlineAtomPathFromDom } from "./domInlineAtomCommandBridge.js";

export interface DomInlineImageInput {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

/**
 * Executes inline image insertion through core and projects only the resulting
 * atom into the existing DOM range. Unrelated DOM and metadata stay untouched.
 */
export const executeDomInlineImageCommand = (
  root: HTMLElement,
  input: DomInlineImageInput,
  domSelection: Selection | null = root.ownerDocument.defaultView?.getSelection() || null,
): HTMLImageElement | null => {
  if (!domSelection?.rangeCount || !domSelection.isCollapsed) return null;
  const modelSelection = selectionFromDom(root, domSelection);
  if (!modelSelection) return null;
  const { document } = smartDocumentFromEditorRoot(root);
  const editor = createSmartEditor({
    state: { document, selection: modelSelection },
    plugins: [mediaPlugin],
  });
  if (!editor.execute("image.insert-inline", input)) return null;
  const selectionAfter = editor.state.selection;
  if (selectionAfter.type !== "text") return null;
  const imagePath = [
    ...selectionAfter.anchor.path.slice(0, -1),
    selectionAfter.anchor.path[selectionAfter.anchor.path.length - 1] - 1,
  ];
  const atom = getNodeAtPath(editor.state.document, imagePath) as SmartInlineImageNode | undefined;
  if (atom?.type !== "inlineImage") return null;

  const range = domSelection.getRangeAt(0);
  const image = root.ownerDocument.createElement("img");
  image.src = atom.src;
  image.alt = atom.alt || "";
  if (atom.title) image.title = atom.title;
  if (atom.width) image.width = atom.width;
  if (atom.height) image.height = atom.height;
  image.dataset.srteInline = "true";
  range.insertNode(image);
  range.setStartAfter(image);
  range.collapse(true);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return image;
};

/** Validates an inline image attribute update through core, then mutates it in place. */
export const executeDomInlineImageUpdate = (
  root: HTMLElement,
  image: HTMLImageElement,
  input: Omit<DomInlineImageInput, "src">,
): boolean => {
  const path = inlineAtomPathFromDom(root, image);
  if (!path) return false;
  const selection = selectionFromDom(
    root,
    root.ownerDocument.defaultView?.getSelection() || null,
  ) || { type: "node" as const, path };
  const { document } = smartDocumentFromEditorRoot(root);
  const editor = createSmartEditor({
    state: { document, selection },
    plugins: [mediaPlugin],
  });
  if (!editor.execute("image.update-inline", { path, ...input })) return false;
  if (input.alt !== undefined) image.alt = input.alt;
  if (input.title !== undefined) image.title = input.title;
  if (input.width !== undefined) image.width = input.width;
  if (input.height !== undefined) image.height = input.height;
  return true;
};
