import { checklistPlugin, createSmartEditor, listPlugin } from "smartrte-core/legacy";
import { smartDocumentFromHtml } from "./domSmartDocument.js";

/**
 * Validates and executes a checklist mutation through core, then projects the
 * changed attribute onto the existing DOM item. Keeping the subtree in place
 * preserves focus, selection, event targets, and framework-owned DOM identity.
 */
export const executeDomChecklistItemCommand = (
  list: HTMLElement,
  item: HTMLElement,
  checked?: boolean,
): HTMLElement | null => {
  if (list.dataset.srteChecklist !== "true" || item.parentElement !== list) return null;
  const items = Array.from(list.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && child.tagName === "LI");
  const index = items.indexOf(item);
  if (index < 0) return null;
  const document = smartDocumentFromHtml(list.outerHTML, list.ownerDocument);
  if (document.children.length !== 1 || document.children[0].type !== "list") return null;
  const editor = createSmartEditor({
    state: { document, selection: { type: "node", path: [0, index] } },
    plugins: [listPlugin, checklistPlugin],
  });
  if (!editor.execute("checklist.set-checked", { path: [0, index], checked })) return null;
  const nextList = editor.state.document.children[0];
  if (nextList.type !== "list") return null;
  const nextItem = nextList.children[index];
  if (!nextItem || nextItem.type !== "listItem") return null;
  item.dataset.checked = nextItem.checked ? "true" : "false";
  item.removeAttribute("data-srte-checked");
  return list;
};
