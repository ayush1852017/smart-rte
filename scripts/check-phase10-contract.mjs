import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assertContract, readSource, root, sourceHas } from "./contract-utils.mjs";

const exists = async (relativePath) => access(resolve(root, relativePath)).then(() => true, () => false);

const [
  registry, dispatch, builtins, tableCommands, canonicalEditor,
  pluginArchitectureDoc, reactIndex, classicEditorAuthority, surfaceInput,
] = await Promise.all([
  readSource("packages/core/src/foundation/plugin/registry.ts"),
  readSource("packages/core/src/foundation/plugin/dispatch.ts"),
  readSource("packages/core/src/foundation/plugin/builtins.ts"),
  readSource("packages/core/src/foundation/table/commands.ts"),
  readSource("packages/react/src/components/CanonicalAuthorityEditor.tsx"),
  readSource("docs/PLUGIN_ARCHITECTURE.md"),
  readSource("packages/react/src/index.ts"),
  readSource("packages/react/src/components/ClassicEditorAuthority.tsx"),
  readSource("packages/core/src/foundation/surface/input.ts"),
]);
const failures = [];

// Gate 2: every PluginCommand requires a non-empty description, enforced at registration.
if (!sourceHas(registry, /requires a non-empty description/)) failures.push("Gate 2: createPluginRegistry does not enforce a non-empty command description.");

// Gate 3: generated per-plugin docs exist for every built-in plugin id.
const builtInIds = ["marks", "list", "block", "table", "atom"];
const pluginDocsDir = resolve(root, "docs/plugins");
const pluginDocFiles = await readdir(pluginDocsDir).catch(() => []);
builtInIds.forEach((id) => {
  if (!pluginDocFiles.includes(`${id}.md`)) failures.push(`Gate 3: docs/plugins/${id}.md is missing - run 'pnpm run docs:plugins'.`);
});
if (!(await exists("scripts/generate-plugin-docs.mjs"))) failures.push("Gate 3: scripts/generate-plugin-docs.mjs is missing.");

// Gate 4: duplicate ids, missing/circular dependencies, and duplicate contribution ids are hard registration errors.
if (!sourceHas(registry, /Duplicate plugin id/) || !sourceHas(registry, /Duplicate command id/)) failures.push("Gate 4: createPluginRegistry does not reject duplicate plugin/command ids.");
if (!sourceHas(registry, /requires missing plugin/) || !sourceHas(registry, /Circular plugin dependency/)) failures.push("Gate 4: createPluginRegistry does not reject missing/circular dependencies.");
if (!sourceHas(registry, /Duplicate \$\{kind\} contribution id/)) failures.push("Gate 4: createPluginRegistry does not reject duplicate UI contribution ids.");

// Gate 5: shortcuts resolve by trying declared-scope candidates in priority
// order (registration order breaks ties) and falling back past any that
// don't actually apply - and surface/input.ts must be the real caller, not
// a parallel unused implementation (see docs/bugs/input-ts-not-wired-to-plugin-shortcut-dispatch.md,
// fixed as part of Phase 11 Tier 0).
if (!sourceHas(dispatch, /export const resolveShortcut/) || !sourceHas(dispatch, /tryShortcut/)) {
  failures.push("Gate 5: plugin/dispatch.ts's resolveShortcut is missing or no longer a fallback-based dispatcher.");
}
if (!sourceHas(surfaceInput, /resolveShortcut/)) {
  failures.push("Gate 5: surface/input.ts does not call resolveShortcut - the live keyboard controller must be wired to the plugin dispatcher, not a parallel unused implementation.");
}

// Gate 6: MediaProvider ships no default; its absence degrades gracefully (UI disabled, not crashed).
if (sourceHas(canonicalEditor, /new\s+(S3|Azure|GCS|R2)\w*Provider/)) failures.push("Gate 6: CanonicalAuthorityEditor references a default cloud MediaProvider implementation.");
if (!sourceHas(canonicalEditor, /!mediaProvider/)) failures.push("Gate 6: CanonicalAuthorityEditor does not gate media UI on mediaProvider's presence.");

// Gates 7/8: disable-safety - the unknown-node passthrough (repair) and its
// reverse (restoreUnknownNodes) both exist, proven by a property/round-trip test.
const schema = await readSource("packages/core/src/foundation/schema.ts");
if (!sourceHas(schema, /export const restoreUnknownNodes/)) failures.push("Gates 7/8: schema.ts is missing restoreUnknownNodes (the re-enable direction).");
const integrationTest = await readSource("packages/core/src/foundation/plugin/integration.test.ts").catch(() => "");
if (!sourceHas(integrationTest, /disable then re-enable round-trips to a byte-for-byte identical document/)) {
  failures.push("Gates 7/8: no test proves a disable-then-re-enable round trip is byte-for-byte identical.");
}

// Gate 9: all five built-in plugins are genuinely converted (non-empty commands), not schema-only stubs.
builtInIds.forEach((id) => {
  if (!sourceHas(builtins, new RegExp(`id:\\s*"${id}"[\\s\\S]{0,200}?commands:\\s*\\w+PluginCommands`))) {
    failures.push(`Gate 9: built-in plugin "${id}" does not appear to register real commands in plugin/builtins.ts.`);
  }
});

// Gate 10: the table plugin uses Phase 8c's fine-grained operations end to end - no reversion to a coarse replaceNode.
if (sourceHas(tableCommands, /replaceTable\s*\(/)) failures.push("Gate 10: table/commands.ts still references a whole-table replaceTable helper.");

// Gate 11: a genuine third-party-style plugin (no internal imports) registers and works - proven in registry.test.ts.
const registryTest = await readSource("packages/core/src/foundation/plugin/registry.test.ts").catch(() => "");
if (!sourceHas(registryTest, /createPluginRegistry/)) failures.push("Gate 11: no test exercises createPluginRegistry with a synthetic, non-built-in plugin.");

// The retired legacy plugin system must actually be gone, not just superseded in docs.
if (await exists("packages/react/src/pluginRuntime.ts")) failures.push("Legacy: packages/react/src/pluginRuntime.ts should have been deleted when the plugin system was retired.");
if (sourceHas(reactIndex, /pluginRuntime\.js/)) failures.push("Legacy: packages/react/src/index.ts still exports from the retired pluginRuntime.ts.");
if (sourceHas(classicEditorAuthority, /features\?:\s*unknown|plugins\?:\s*unknown|mediaManager\?:\s*unknown/)) {
  failures.push("Legacy: ClassicEditorAuthority.tsx still carries the dead legacy plugin props.");
}
if (!sourceHas(pluginArchitectureDoc, /createPluginRegistry/)) failures.push("Legacy: docs/PLUGIN_ARCHITECTURE.md was not updated to describe the new plugin system.");

if (assertContract("Phase 10 plugin ownership", failures)) {
  process.stdout.write("Phase 10 contract: runtime plugin registration, disable-safety, scope-kind shortcut dispatch, doc generation, and the retired legacy system's removal all passed.\n");
}
