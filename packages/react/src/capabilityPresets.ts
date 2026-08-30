import { baseSchema, builtInPlugins, createPluginRegistry, foundationSchema, type PluginRegistry } from "smartrte-core/foundation";

/**
 * A named, host-facing restriction of which built-in plugins an editor
 * instance is constructed with - a small extension of Phase 10's existing
 * plugin enable/disable mechanism (`createPluginRegistry`,
 * `docs/PLUGIN_ARCHITECTURE.md`), not new architecture. `FoundationEditor`
 * already accepted a custom `schema`/`commands`/`keyboardShortcuts`/
 * `contextMenu` (`editor.ts`'s `FoundationEditorOptions`) since Phase 10 -
 * nothing here builds new core capability, it just gives the react layer a
 * convenient, named way to reach for it.
 *
 * This is an editor-construction-time, host/integrator-level setting - not
 * end-user-facing toolbar customization. There is no UI for a person typing
 * in the editor to change their own preset.
 *
 * Real-world driver: Sootr's question-style content (MCQ, Anomaly, PYEQ)
 * deliberately excludes tables (`enableTable={false}` in every one of those
 * call sites - see `docs/SOOTR_MIGRATION_READINESS.md` gap #3), while its
 * study-material block editor wants everything. Two presets, not more,
 * because that is the one dimension any real caller has ever needed to
 * vary; nothing in this codebase's history has asked to disable media or
 * formula independently of each other (they're both owned by the single
 * "atom" plugin today, which would need splitting to support that -
 * deliberately out of scope here, since nothing needs it yet).
 */
export type EditorCapabilityPreset = "simple" | "full";

/** Plugin ids to exclude for each preset - "full" excludes nothing, matching today's only behavior exactly (so every existing consumer who never sets `preset` is 100% unaffected). */
const PRESET_EXCLUDED_PLUGIN_IDS: Record<EditorCapabilityPreset, readonly string[]> = {
  simple: ["table"],
  full: [],
};

/**
 * Registries are real work to build (schema construction + validation, per
 * `createPluginRegistry`) - computed once per preset at module load, not
 * per editor instance, since the preset set is small and fixed.
 */
const registryCache = new Map<EditorCapabilityPreset, PluginRegistry>();

export const capabilityPresetRegistry = (preset: EditorCapabilityPreset): PluginRegistry => {
  const cached = registryCache.get(preset);
  if (cached) return cached;
  const excluded = new Set(PRESET_EXCLUDED_PLUGIN_IDS[preset]);
  const registry = createPluginRegistry(
    builtInPlugins.filter((plugin) => !excluded.has(plugin.id)),
    { baseSchema, schemaVersion: foundationSchema.version },
  );
  registryCache.set(preset, registry);
  return registry;
};
