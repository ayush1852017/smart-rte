import {
  createCorePlugins,
  orderPlugins,
  type CoreFeatureConfig,
  type CoreFeatureId,
  type SmartRtePlugin,
} from "smartrte-core/legacy";
import type { ReactNode } from "react";

export type ReactEditorFeatureConfig = CoreFeatureConfig;

export interface ReactCommandContributionContext {
  root: HTMLElement | null;
  selection: Selection | null;
  readOnly: boolean;
  canExecute: (commandId: string, input?: unknown) => boolean;
}

export interface ReactCommandContribution {
  id: string;
  commandId: string;
  input?: unknown;
  order?: number;
  isVisible?: (context: ReactCommandContributionContext) => boolean;
  isEnabled?: (context: ReactCommandContributionContext) => boolean;
  isActive?: (context: ReactCommandContributionContext) => boolean;
}

export interface ReactToolbarContribution extends ReactCommandContribution {
  label: string;
  title?: string;
  placement?: "main" | "insert" | "more";
  icon?: ReactNode;
}

export interface ReactKeyboardShortcutContribution extends ReactCommandContribution {
  key: string;
  primary?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface ReactContextMenuContext {
  root: HTMLElement;
  target: HTMLElement;
  selection: Selection | null;
}

export interface ReactContextMenuContribution extends ReactCommandContribution {
  label: string;
  when?: (context: ReactContextMenuContext) => boolean;
}

export interface ReactPluginUi {
  toolbar?: readonly ReactToolbarContribution[];
  shortcuts?: readonly ReactKeyboardShortcutContribution[];
  contextMenu?: readonly ReactContextMenuContribution[];
}

export type ReactEditorPlugin = SmartRtePlugin & {
  react?: ReactPluginUi;
};

const pluginIdByFeature: Record<CoreFeatureId, string> = {
  basicFormatting: "basic-formatting",
  blockType: "block-type",
  alignment: "alignment",
  list: "list",
  checklist: "checklist",
  blockquote: "blockquote",
  codeBlock: "code-block",
  table: "table",
  media: "media",
  formula: "formula",
  move: "move",
};

export interface ReactEditorPluginRuntime {
  plugins: readonly SmartRtePlugin[];
  featureIds: ReadonlySet<CoreFeatureId>;
  toolbar: readonly ReactToolbarContribution[];
  shortcuts: readonly ReactKeyboardShortcutContribution[];
  contextMenu: readonly ReactContextMenuContribution[];
  hasFeature: (feature: CoreFeatureId) => boolean;
}

/**
 * Resolves one authoritative plugin set for both React UI availability and
 * core command execution. Passing `plugins` creates an exact custom runtime;
 * otherwise the standard plugin preset is filtered by `features`.
 */
export const createReactEditorPluginRuntime = (options: {
  features?: ReactEditorFeatureConfig;
  plugins?: readonly ReactEditorPlugin[];
} = {}): ReactEditorPluginRuntime => {
  const plugins = orderPlugins(
    options.plugins ? [...options.plugins] : createCorePlugins(options.features),
  );
  const pluginIds = new Set(plugins.map((plugin) => plugin.id));
  const featureIds = new Set(
    (Object.keys(pluginIdByFeature) as CoreFeatureId[])
      .filter((feature) => pluginIds.has(pluginIdByFeature[feature])),
  );
  const commandIds = new Set(plugins.flatMap((plugin) => Object.keys(plugin.commands || {})));
  const contributionIds = new Set<string>();
  const ordered = <T extends { order?: number }>(items: T[]) =>
    items.map((item, index) => ({ item, index }))
      .sort((left, right) =>
        (left.item.order ?? 0) - (right.item.order ?? 0) || left.index - right.index)
      .map(({ item }) => item);
  const validateContribution = (
    pluginId: string,
    contribution: { id: string; commandId: string },
    kind: string,
  ) => {
    if (!contribution.id.trim()) throw new Error(`Plugin "${pluginId}" has a ${kind} contribution with an empty id.`);
    if (contributionIds.has(contribution.id)) {
      throw new Error(`Duplicate UI contribution id "${contribution.id}".`);
    }
    if (!commandIds.has(contribution.commandId)) {
      throw new Error(
        `${kind} contribution "${contribution.id}" references missing command "${contribution.commandId}".`,
      );
    }
    contributionIds.add(contribution.id);
  };
  const toolbar = ordered(plugins.flatMap((plugin) =>
    ((plugin as ReactEditorPlugin).react?.toolbar || []).map((contribution) => {
      validateContribution(plugin.id, contribution, "Toolbar");
      return { ...contribution };
    })));
  const shortcuts = ordered(plugins.flatMap((plugin) =>
    ((plugin as ReactEditorPlugin).react?.shortcuts || []).map((contribution) => {
      validateContribution(plugin.id, contribution, "Shortcut");
      if (!contribution.key.trim()) {
        throw new Error(`Shortcut contribution "${contribution.id}" requires a key.`);
      }
      return { ...contribution, key: contribution.key.toLowerCase() };
    })));
  const contextMenu = ordered(plugins.flatMap((plugin) =>
    ((plugin as ReactEditorPlugin).react?.contextMenu || []).map((contribution) => {
      validateContribution(plugin.id, contribution, "Context menu");
      return { ...contribution };
    })));
  return {
    plugins,
    featureIds,
    toolbar,
    shortcuts,
    contextMenu,
    hasFeature: (feature) => featureIds.has(feature),
  };
};

export const matchesPluginShortcut = (
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: ReactKeyboardShortcutContribution,
) =>
  event.key.toLowerCase() === shortcut.key.toLowerCase() &&
  (shortcut.primary ? event.metaKey || event.ctrlKey : !event.metaKey && !event.ctrlKey) &&
  event.altKey === Boolean(shortcut.alt) &&
  event.shiftKey === Boolean(shortcut.shift);
