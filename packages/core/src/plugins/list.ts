import { indentListItems, outdentListItems, toggleList } from "../legacyCommands/list.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createListPlugin = (): SmartRtePlugin => ({
  id: "list",
  commands: {
    [toggleList.id]: toggleList,
    [indentListItems.id]: indentListItems,
    [outdentListItems.id]: outdentListItems,
  },
});

export const listPlugin = createListPlugin();
