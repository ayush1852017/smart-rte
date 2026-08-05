import { toggleBlockquote } from "../legacyCommands/blocks.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createBlockquotePlugin = (): SmartRtePlugin => ({
  id: "blockquote",
  commands: { [toggleBlockquote.id]: toggleBlockquote },
});

export const blockquotePlugin = createBlockquotePlugin();
