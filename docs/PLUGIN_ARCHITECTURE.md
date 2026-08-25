# Plugin architecture

**Status: rewritten for Phase 10 (2026-08-18).** The previous version of this document described `<ClassicEditor features={...} />` / `<ClassicEditor plugins={[...]} />` — a real, tested system (`packages/react/src/pluginRuntime.ts`, `SmartRtePlugin`), but one that only ever drove the DOM-authoritative `LegacyClassicEditor`. Once that component was retired at the Phase 8b closeout (2026-08-12), `ClassicEditor`'s `features`/`plugins`/`formats`/`formatDefinitions`/`mediaManager` props became silent no-ops — canonical authority never read them. `pluginRuntime.ts` and those props have now been deleted rather than left as misleading documentation. This document describes the plugin system that actually drives the live, canonical editor.

## One authority, genuinely runtime-pluggable

A feature (marks, lists, tables, blocks, atoms, and any third-party extension) is a `FoundationPlugin`: it owns its schema contribution (node/mark types), commands, normalizers, clipboard normalizers, keyboard shortcuts, toolbar/context-menu contributions, and format codecs. Unlike the retired system, this one is load-bearing for the schema itself — `foundationSchema` (the "all built-ins" preset) is computed by registering every built-in plugin, not hand-maintained as a literal.

```ts
import { createPluginRegistry, builtInPlugins } from "smartrte-core/foundation";

const registry = createPluginRegistry(builtInPlugins, {
  baseSchema: { nodes: [/* doc, text, hard_break, unknown */] },
  schemaVersion: 2,
});

const editor = createFoundationEditor({
  document, selection,
  schema: registry.schema,
  normalizers: registry.normalizers,
});
```

Registering a **subset** of `builtInPlugins` genuinely shrinks the schema — a document containing a node type from an excluded plugin has that content demoted to a read-only, round-tripping `unknown` node (the same mechanism that already protects genuinely unrecognized content, e.g. from DOCX import). Re-registering the plugin and re-resolving the document restores it losslessly, with no edits needed in between. This is the actual disable/re-enable contract, not just a documentation promise.

## Plugin shape

```ts
interface FoundationPlugin {
  id: string;
  version: string;
  requires?: readonly string[];   // hard dependency - missing or cyclic fails registration
  optional?: readonly string[];   // soft dependency - ordered after if present, no error if absent
  priority?: number;              // higher wins a genuine tie in contribution ordering
  schema?: { nodes?: readonly NodeSpec[]; marks?: readonly MarkSpec[] };
  commands: Record<string, PluginCommand>;
  normalizers?: readonly NormalizerRegistration[];
  keyboardShortcuts?: readonly KeyboardShortcutContribution[];
  clipboard?: { normalizers?: readonly SourceNormalizer[]; priority?: number };
  renderer?: { nodeRenderers?: Record<string, unknown>; priority?: number };
  toolbar?: readonly ToolbarContribution[];
  contextMenu?: readonly ContextMenuContribution[];
  formats?: Record<string, FeatureFormatCodec>;
}
```

Every `PluginCommand` requires a non-empty `description` (enforced at registration and by the `scripts/generate-plugin-docs.mjs --check` CI gate) plus optional `examples`/`options` — this is what per-plugin reference docs (`docs/plugins/*.md`) are generated from. A command's `run` is exactly the existing per-family command function shape (`(document, scope, params, ctx) => SmartOperation[]`) — converting a family wraps its already-tested commands, it does not rewrite them.

## Registering the five built-ins

```ts
import { builtInPlugins } from "smartrte-core/foundation";
// [marksPlugin, listPlugin, blockPlugin, tablePlugin, atomPlugin]
```

Each was converted from its existing command set (`marks/commands.ts`, `list/commands.ts`, `block/commands.ts`, `table/commands.ts`, `atom/commands.ts`) with zero behavioral changes — every wrapped command is proven, by test, to produce output identical to calling the underlying function directly.

## Conflict resolution

- **Commands / schema / contributions**: duplicate ids across plugins are a hard registration error (`createPluginRegistry` throws immediately), the same fail-fast posture the retired system had.
- **Dependencies**: `requires` is topologically ordered; a missing hard dependency or a cycle is a hard error. `optional` participates in ordering only when present.
- **Keyboard shortcuts**: each declares the `ScopeKind`(s) it applies to (`scope/types.ts`'s existing taxonomy: `inline-range`, `block-range`, `list-selection`, `table-grid`, `atomic-node`, `container-tree`, `mixed`, `empty`). `resolveShortcut` (`plugin/dispatch.ts`) picks the contribution whose scope matches the cursor's resolved scope, falling back to `priority` then registration order only on a genuine tie for the same key and scope kind — a data-driven replacement for hardcoding precedence per key.
- **Clipboard normalizers**: collected and priority-ordered by `createPluginRegistry`, passed as `ClipboardPipelineOptions.normalizers` — the clipboard pipeline (`clipboard/pipeline.ts`) already had this exact extension point (it takes priority over the built-in fallback normalizer set); no new pipeline mechanism was needed.

## What is still core-owned, not plugin-owned

- **`MediaProvider`/`mediaPicker`** (`packages/react/src/mediaProvider.ts`) remain direct `CanonicalAuthorityEditor` props, not manifest fields. A provider's job ends at producing a URL; `atom.insert` takes it from there like any other `src`. There was no reason to route an already-working upload/picker contract through the manifest.
- **Renderer contributions** exist in the manifest shape (`renderer.nodeRenderers`) but are not yet consumed by a live per-node-type render registry — the canonical DOM renderer is not yet plugin-driven for rendering itself, only for schema/commands/clipboard/shortcuts.

## Third-party plugins

A plugin authored entirely outside this repository, with no internal imports, registers the same way a built-in does:

```ts
import { createPluginRegistry, builtInPlugins } from "smartrte-core/foundation";

const reviewPlugin: FoundationPlugin = {
  id: "review",
  version: "1.0.0",
  commands: {
    "review.insert": {
      id: "review.insert",
      description: "Inserts a review marker at the current position.",
      run: (document, scope, params, ctx) => [/* ... */],
    },
  },
  toolbar: [{ id: "review-button", commandId: "review.insert", label: "Review" }],
};

const registry = createPluginRegistry([...builtInPlugins, reviewPlugin], { baseSchema, schemaVersion: 2 });
```
