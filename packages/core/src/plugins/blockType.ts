import { setBlockType } from "../legacyCommands/blocks.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createBlockTypePlugin = (): SmartRtePlugin => ({
  id: "block-type",
  commands: { [setBlockType.id]: setBlockType },
});

export const blockTypePlugin = createBlockTypePlugin();
