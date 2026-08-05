import { setAlignment } from "../legacyCommands/alignment.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createAlignmentPlugin = (): SmartRtePlugin => ({
  id: "alignment",
  commands: { [setAlignment.id]: setAlignment },
});

export const alignmentPlugin = createAlignmentPlugin();
