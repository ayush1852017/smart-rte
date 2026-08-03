import type { FoundationEditor } from "../editor.js";
import type { InlineRangeScope, SelectionDescription } from "../scope/types.js";
import type { Attrs, SmartMark, SmartOperation } from "../types.js";
import { canonicalMarkAttrs, canonicalMarkOrder } from "./canonical.js";
import { applyMarkCommand, clearAllMarksCommand, editLinkCommand, removeLinkCommand, removeMarkCommand, toggleMarkCommand } from "./commands.js";
import { marksAtInsertion } from "./stored.js";
import type { InlineToolDeclaration } from "./types.js";

export type MarkIntent = "apply" | "remove" | "toggle" | "setAttrs" | "clearAll" | "editLink";

const updateCollapsed = (
  current: readonly SmartMark[],
  declaration: InlineToolDeclaration,
  intent: MarkIntent,
  attrs?: Attrs,
): SmartMark[] => {
  if (intent === "clearAll") return [];
  const exists = current.some((mark) => mark.type === declaration.markType);
  const remove = intent === "remove" || intent === "toggle" && exists;
  const without = current.filter((mark) => mark.type !== declaration.markType
    && !(declaration.excludes || []).includes(mark.type));
  if (remove) return canonicalMarkOrder(without);
  const canonicalAttrs = canonicalMarkAttrs(declaration.markType, attrs);
  if (canonicalAttrs === null || declaration.validate?.(canonicalAttrs) === false) {
    throw new Error(`Invalid attributes for mark "${declaration.markType}".`);
  }
  return canonicalMarkOrder([...without, {
    type: declaration.markType,
    ...(Object.keys(canonicalAttrs).length ? { attrs: canonicalAttrs } : {}),
  }]);
};

/** Editor-state adapter; the underlying mark commands remain pure and editor-free. */
export const executeMarkTool = (
  editor: FoundationEditor,
  declaration: InlineToolDeclaration,
  intent: MarkIntent,
  attrs?: Attrs,
): SmartOperation[] => {
  const scope = editor.resolveScope({ want: "inline-range" });
  if (!("kind" in scope) || scope.kind !== "inline-range") return [];
  const inline = scope as InlineRangeScope;
  const description = editor.resolveScope({ want: "describe" }) as SelectionDescription;
  if (inline.collapsed && !(declaration.markType === "link" && (intent === "remove" || intent === "editLink"))) {
    const current = editor.storedMarks || marksAtInsertion(editor.document, editor.selection.head, editor.schema);
    editor.setStoredMarks(updateCollapsed(current, declaration, intent, attrs), { source: "toolbar" });
    return [];
  }
  const context = { schema: editor.schema, positions: editor.positions };
  const coverage = description.marks.some((entry) => entry.mark.type === declaration.markType && entry.coverage === "all")
    ? "all" as const
    : description.marks.some((entry) => entry.mark.type === declaration.markType) ? "partial" as const : "none" as const;
  const operations = intent === "clearAll" ? clearAllMarksCommand(editor.document, inline, {}, context)
    : intent === "remove" && declaration.markType === "link" ? removeLinkCommand(editor.document, inline, { markType: "link" }, context)
      : intent === "editLink" && declaration.markType === "link" ? editLinkCommand(editor.document, inline, attrs as { href: string; target?: string }, context)
        : intent === "remove" ? removeMarkCommand(editor.document, inline, { markType: declaration.markType }, context)
          : intent === "toggle" ? toggleMarkCommand(editor.document, inline, { markType: declaration.markType, attrs, coverage }, context)
            : applyMarkCommand(editor.document, inline, { markType: declaration.markType, attrs }, context);
  if (operations.length) editor.transact((builder) => {
    builder.operations.push(...operations);
    builder.setSelection(editor.selection);
  }, { source: "toolbar", addToHistory: true });
  return operations;
};
