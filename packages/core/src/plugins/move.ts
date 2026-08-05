import { indentBlocks, moveBlocks } from "../legacyCommands/move.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createMovePlugin = (): SmartRtePlugin => ({
  id: "move",
  commands: {
    [moveBlocks.id]: moveBlocks,
    [indentBlocks.id]: indentBlocks,
  },
});

export const movePlugin = createMovePlugin();
