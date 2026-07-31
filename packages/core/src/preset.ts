import type { SmartRtePlugin } from "./plugin.js";
import { alignmentPlugin } from "./plugins/alignment.js";
import { basicFormattingPlugin } from "./plugins/basicFormatting.js";
import { blockquotePlugin } from "./plugins/blockquote.js";
import { blockTypePlugin } from "./plugins/blockType.js";
import { checklistPlugin } from "./plugins/checklist.js";
import { codeBlockPlugin } from "./plugins/codeBlock.js";
import { formulaPlugin } from "./plugins/formula.js";
import { listPlugin } from "./plugins/list.js";
import { mediaPlugin } from "./plugins/media.js";
import { movePlugin } from "./plugins/move.js";
import { tablePlugin } from "./plugins/table.js";

export type CoreFeatureId =
  | "basicFormatting"
  | "blockType"
  | "alignment"
  | "list"
  | "checklist"
  | "blockquote"
  | "codeBlock"
  | "table"
  | "media"
  | "formula"
  | "move";

export type CoreFeatureConfig = Partial<Record<CoreFeatureId, boolean>>;

const features: Record<CoreFeatureId, SmartRtePlugin> = {
  basicFormatting: basicFormattingPlugin,
  blockType: blockTypePlugin,
  alignment: alignmentPlugin,
  list: listPlugin,
  checklist: checklistPlugin,
  blockquote: blockquotePlugin,
  codeBlock: codeBlockPlugin,
  table: tablePlugin,
  media: mediaPlugin,
  formula: formulaPlugin,
  move: movePlugin,
};

const featureOrder = Object.keys(features) as CoreFeatureId[];

/**
 * Creates the standard model plugin set.
 *
 * Features default to enabled. Disabling `list` also disables `checklist`,
 * because checklist commands depend on list structure. Applications can append
 * custom plugins to the returned array before constructing an editor.
 */
export const createCorePlugins = (config: CoreFeatureConfig = {}): SmartRtePlugin[] => {
  const enabled = (id: CoreFeatureId) => config[id] !== false;
  return featureOrder
    .filter((id) => enabled(id))
    .filter((id) => id !== "checklist" || enabled("list"))
    .map((id) => features[id]);
};

export const corePlugins = createCorePlugins();
