import { createSchema, type SchemaContribution } from "../schemaBuilder.js";
import type { NormalizerRegistration, SmartSchema } from "../types.js";
import type { SourceNormalizer } from "../clipboard/types.js";
import type {
  ClipboardContribution, ContextMenuContribution, FoundationPlugin, KeyboardShortcutContribution,
  PluginCommand, RendererContribution, ToolbarContribution,
} from "./types.js";

export interface PluginRegistry {
  readonly plugins: readonly FoundationPlugin[];
  readonly pluginIds: ReadonlySet<string>;
  readonly schema: SmartSchema;
  readonly commands: ReadonlyMap<string, PluginCommand>;
  readonly normalizers: readonly NormalizerRegistration[];
  readonly clipboardNormalizers: readonly SourceNormalizer[];
  readonly keyboardShortcuts: readonly KeyboardShortcutContribution[];
  readonly toolbar: readonly ToolbarContribution[];
  readonly contextMenu: readonly ContextMenuContribution[];
  readonly renderer: readonly RendererContribution[];
  hasPlugin(id: string): boolean;
}

/** Dependency-ordered so a plugin's `requires` are always registered before it. */
const orderPlugins = (plugins: readonly FoundationPlugin[]): FoundationPlugin[] => {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  if (byId.size !== plugins.length) {
    const seen = new Set<string>();
    const duplicate = plugins.find((plugin) => (seen.has(plugin.id) ? true : (seen.add(plugin.id), false)));
    throw new Error(`Duplicate plugin id "${duplicate?.id}".`);
  }
  const ordered: FoundationPlugin[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (plugin: FoundationPlugin) => {
    if (visited.has(plugin.id)) return;
    if (visiting.has(plugin.id)) throw new Error(`Circular plugin dependency involving "${plugin.id}".`);
    visiting.add(plugin.id);
    (plugin.requires || []).forEach((requiredId) => {
      const required = byId.get(requiredId);
      if (!required) throw new Error(`Plugin "${plugin.id}" requires missing plugin "${requiredId}".`);
      visit(required);
    });
    (plugin.optional || []).forEach((optionalId) => {
      const optional = byId.get(optionalId);
      if (optional) visit(optional);
    });
    visiting.delete(plugin.id);
    visited.add(plugin.id);
    ordered.push(plugin);
  };
  plugins.forEach(visit);
  return ordered;
};

const byPriorityThenOrder = <T extends { priority?: number }>(items: readonly { item: T; index: number }[]) =>
  [...items].sort((left, right) => (right.item.priority ?? 0) - (left.item.priority ?? 0) || left.index - right.index)
    .map(({ item }) => item);

/**
 * Builds one authoritative registry from a plugin list: dependency-ordered,
 * schema merged via the existing createSchema (same duplicate-type/duplicate-
 * mark checks it has always enforced), commands/contributions merged with
 * hard duplicate-id errors - mirroring the validation shape
 * packages/react/src/pluginRuntime.ts already proved out for the now-retired
 * legacy system, rebuilt here for the canonical architecture.
 *
 * `baseSchema` covers node/mark types no feature family owns and that must
 * exist regardless of which plugins are registered - `doc` (the document
 * root), `text`, `hard_break`, and `unknown` (the disable-safety passthrough
 * node type itself, which would be a chicken-and-egg problem if any plugin
 * had to own it).
 */
export const createPluginRegistry = (
  plugins: readonly FoundationPlugin[],
  options: { baseSchema: SchemaContribution; topNode?: string; schemaVersion: number },
): PluginRegistry => {
  const ordered = orderPlugins(plugins);
  const pluginIds = new Set(ordered.map((plugin) => plugin.id));

  const schema = createSchema({
    version: options.schemaVersion,
    topNode: options.topNode,
    nodes: [...(options.baseSchema.nodes || [])],
    marks: [...(options.baseSchema.marks || [])],
    extensions: ordered.map((plugin) => ({ nodes: plugin.schema?.nodes, marks: plugin.schema?.marks })),
  });

  const commands = new Map<string, PluginCommand>();
  ordered.forEach((plugin) => {
    Object.values(plugin.commands).forEach((command) => {
      if (commands.has(command.id)) throw new Error(`Duplicate command id "${command.id}" (from plugin "${plugin.id}").`);
      if (!command.description.trim()) throw new Error(`Command "${command.id}" (plugin "${plugin.id}") requires a non-empty description.`);
      commands.set(command.id, command);
    });
  });

  const normalizers = ordered.flatMap((plugin) => plugin.normalizers || []);
  const clipboardNormalizers = ordered
    .map((plugin, index) => ({ item: plugin.clipboard, index, priority: plugin.clipboard?.priority }))
    .filter((entry): entry is typeof entry & { item: ClipboardContribution } => Boolean(entry.item?.normalizers?.length))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.index - right.index)
    .flatMap((entry) => entry.item.normalizers || []);

  const contributionIds = new Set<string>();
  const validateContribution = (pluginId: string, kind: string, contribution: { id: string; commandId: string }) => {
    if (!contribution.id.trim()) throw new Error(`Plugin "${pluginId}" has a ${kind} contribution with an empty id.`);
    if (contributionIds.has(contribution.id)) throw new Error(`Duplicate ${kind} contribution id "${contribution.id}".`);
    if (!commands.has(contribution.commandId)) {
      throw new Error(`${kind} contribution "${contribution.id}" (plugin "${pluginId}") references missing command "${contribution.commandId}".`);
    }
    contributionIds.add(contribution.id);
  };

  const collect = <T extends { id: string; commandId: string; priority?: number }>(kind: string, pick: (plugin: FoundationPlugin) => readonly T[] | undefined) =>
    byPriorityThenOrder(ordered.flatMap((plugin, pluginIndex) => (pick(plugin) || []).map((contribution, index) => {
      validateContribution(plugin.id, kind, contribution);
      return { item: contribution, index: pluginIndex * 100_000 + index };
    })));

  const keyboardShortcuts = collect("Shortcut", (plugin) => plugin.keyboardShortcuts);
  const toolbar = collect("Toolbar", (plugin) => plugin.toolbar);
  const contextMenu = collect("Context menu", (plugin) => plugin.contextMenu);
  const renderer = ordered
    .map((plugin, index) => ({ item: plugin.renderer, index, priority: plugin.renderer?.priority }))
    .filter((entry): entry is typeof entry & { item: RendererContribution } => Boolean(entry.item))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.index - right.index)
    .map((entry) => entry.item);

  return {
    plugins: ordered,
    pluginIds,
    schema,
    commands,
    normalizers,
    clipboardNormalizers,
    keyboardShortcuts,
    toolbar,
    contextMenu,
    renderer,
    hasPlugin: (id) => pluginIds.has(id),
  };
};
