import { toggleCodeBlock } from "../commands/code.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createCodeBlockPlugin = (): SmartRtePlugin => ({
  id: "code-block",
  commands: { [toggleCodeBlock.id]: toggleCodeBlock },
});

export const codeBlockPlugin = createCodeBlockPlugin();
