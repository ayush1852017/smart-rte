import type { SmartCommand } from "./command.js";
import type { SmartDocument } from "./model.js";
import type { SmartSchemaExtension } from "./schema.js";
import type { SmartTransaction } from "./transaction.js";

// Commands intentionally carry heterogeneous input types inside a plugin map.
// The runtime restores the concrete input type at execute/canExecute boundaries.
export type SmartPluginCommand = SmartCommand<any>;
export type SmartNormalizer = (document: SmartDocument) => SmartDocument;

export interface SmartRtePlugin {
  id: string;
  dependencies?: string[];
  commands?: Record<string, SmartPluginCommand>;
  schema?: Omit<SmartSchemaExtension, "id">;
  normalizers?: SmartNormalizer[];
  onTransaction?: (transaction: SmartTransaction) => void;
}

export const orderPlugins = (plugins: readonly SmartRtePlugin[]): SmartRtePlugin[] => {
  const byId = new Map<string, SmartRtePlugin>();
  plugins.forEach((plugin) => {
    if (!plugin.id.trim()) throw new Error("Plugin id cannot be empty.");
    if (byId.has(plugin.id)) throw new Error(`Duplicate plugin id "${plugin.id}".`);
    byId.set(plugin.id, plugin);
  });

  const ordered: SmartRtePlugin[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (plugin: SmartRtePlugin) => {
    if (visited.has(plugin.id)) return;
    if (visiting.has(plugin.id)) throw new Error(`Circular plugin dependency involving "${plugin.id}".`);
    visiting.add(plugin.id);
    (plugin.dependencies || []).forEach((dependency) => {
      const required = byId.get(dependency);
      if (!required) throw new Error(`Plugin "${plugin.id}" requires missing plugin "${dependency}".`);
      visit(required);
    });
    visiting.delete(plugin.id);
    visited.add(plugin.id);
    ordered.push(plugin);
  };
  plugins.forEach(visit);
  return ordered;
};
