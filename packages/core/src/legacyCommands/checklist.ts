import type { LegacyCommandContext, SmartCommand } from "../command.js";
import { getNodeAtPath, type Path, type SmartListItemNode } from "../model.js";
import { toggleList } from "./list.js";

export interface ToggleChecklistInput {
  strikeCompleted?: boolean;
}

export const toggleChecklist: SmartCommand<ToggleChecklistInput> = {
  id: "checklist.toggle",
  isEnabled: (context) =>
    toggleList.isEnabled(context, { style: "disc", checklist: true }),
  execute: (context, input) => ({
    ...toggleList.execute(context, {
      style: "disc",
      checklist: true,
      strikeCompleted: input?.strikeCompleted,
    }),
    id: "checklist.toggle",
  }),
};

export interface SetChecklistItemInput {
  path: Path;
  checked?: boolean;
}

export const setChecklistItemChecked: SmartCommand<SetChecklistItemInput> = {
  id: "checklist.set-checked",
  isEnabled: (context, input) => {
    if (!input) return false;
    const item = getNodeAtPath(context.document, input.path) as SmartListItemNode | undefined;
    const list = getNodeAtPath(context.document, input.path.slice(0, -1));
    return item?.type === "listItem" &&
      (list as { type?: string; checklist?: boolean } | undefined)?.type === "list" &&
      Boolean((list as { checklist?: boolean }).checklist);
  },
  execute: (context, input) => {
    if (!input || !setChecklistItemChecked.isEnabled(context, input)) {
      throw new Error("checklist.set-checked requires an item in a checklist.");
    }
    const item = getNodeAtPath(context.document, input.path) as SmartListItemNode;
    return {
      id: "checklist.set-checked",
      source: "user",
      operations: [{
        type: "setNodeAttrs",
        path: input.path,
        attrs: { checked: input.checked ?? !item.checked },
      }],
      selectionBefore: context.selection,
      selectionAfter: context.selection,
      addToHistory: true,
      timestamp: context.now?.() ?? Date.now(),
    };
  },
};
