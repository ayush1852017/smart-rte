import { setChecklistItemChecked, toggleChecklist } from "../legacyCommands/checklist.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createChecklistPlugin = (): SmartRtePlugin => ({
  id: "checklist",
  dependencies: ["list"],
  commands: {
    [toggleChecklist.id]: toggleChecklist,
    [setChecklistItemChecked.id]: setChecklistItemChecked,
  },
});

export const checklistPlugin = createChecklistPlugin();
