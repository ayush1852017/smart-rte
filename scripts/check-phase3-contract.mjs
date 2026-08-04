import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [commands, types, classic, bridge, rootIndex, legacyIndex, corePackage, shadow, touchpoints, adapters, behaviorChanges] = await Promise.all([
  "packages/core/src/foundation/list/commands.ts",
  "packages/core/src/foundation/list/types.ts",
  "packages/react/src/components/ClassicEditor.tsx",
  "packages/react/src/adapters/canonicalListCommandBridge.ts",
  "packages/core/src/index.ts",
  "packages/core/src/legacy/index.ts",
  "packages/core/package.json",
  "packages/core/src/foundation/list/shadow.ts",
  "docs/LEGACY_LIST_TOUCHPOINTS.md",
  "docs/MIGRATION_ADAPTER_INVENTORY.md",
  "docs/PHASE_3_STRUCTURAL_BEHAVIOR_CHANGES.md",
].map(async (path) => [path, await readFile(resolve(root, path), "utf8")]));

const source = Object.fromEntries([
  commands, types, classic, bridge, rootIndex, legacyIndex, corePackage, shadow,
  touchpoints, adapters, behaviorChanges,
]);
const violations = [];
if (!/type ListCommand<P>\s*=\s*\(\s*document:\s*SmartDocument,\s*scope:\s*ResolvedScope,\s*params:\s*P,\s*ctx:\s*CommandContext/s.test(source[types[0]])) {
  violations.push("ListCommand no longer has the pure (document, scope, params, ctx) signature");
}
if (/\b(?:editor|transaction|selection)\b/.test(source[types[0]].match(/type ListCommand<P>[\s\S]*?SmartOperation\[\];/)?.[0] || "")) {
  violations.push("ListCommand signature leaked editor/transaction/selection authority");
}
for (const id of ["create", "unwrap", "indent", "outdent", "setPreset", "setStyle", "setChecked", "move", "restartNumbering", "continueNumbering"]) {
  if (!new RegExp(`"list\\.${id}"`).test(source[commands[0]])) violations.push(`missing pure list.${id} command`);
}
if (/Legacy implementation retained|nestSelectedListItems|outdentSelectedListItems|\.execute\(\s*["']list\.(?:indent|outdent|toggle)/.test(source[classic[0]])) {
  violations.push("ClassicEditor still contains a legacy list mutation path");
}
for (const route of ["executeCanonicalListDepth", "executeCanonicalListMove", "executeCanonicalListStyle", "executeCanonicalListToggle", "executeCanonicalListStructuralInput"]) {
  if (!source[classic[0]].includes(route) || !source[bridge[0]].includes(`export const ${route}`)) violations.push(`ClassicEditor is not routed through ${route}`);
}
if (!source[rootIndex[0]].includes('export * from "./foundation/index.js"')) violations.push("root canonical promotion missing");
if (!source[legacyIndex[0]].includes("Compatibility API") || !source[corePackage[0]].includes('"./legacy"')) violations.push("legacy rename subpath missing");
if (!/normalized document structure with IDs stripped/.test(source[shadow[0]]) || !/never document text/.test(source[shadow[0]])) {
  violations.push("shadow equivalence/privacy policy is not frozen in code");
}
const expectedTouchpoints = new Map([
  ["imported-list-normalization", "Phase8"],
]);
const actualTouchpoints = [...source[classic[0]].matchAll(/LEGACY_LIST_TOUCHPOINT:\s+(\S+)\s+owner=(Phase\d+)/g)];
if (actualTouchpoints.length !== expectedTouchpoints.size) violations.push("legacy list-touching inventory count changed without a contract update");
for (const [, marker, owner] of actualTouchpoints) {
  if (expectedTouchpoints.get(marker) !== owner || !source[touchpoints[0]].includes(`\`${marker}\``)) {
    violations.push(`untracked legacy list touchpoint ${marker} (${owner})`);
  }
}
const migrationAdapters = [...source[bridge[0]].matchAll(/MIGRATION_ADAPTER:\s+(\S+)\s+owner=(Phase\d+)/g)];
if (migrationAdapters.length !== 1 || migrationAdapters[0]?.[1] !== "canonical-list-dom-roundtrip" || migrationAdapters[0]?.[2] !== "Phase8") {
  violations.push("temporary canonical list adapter inventory changed without a contract update");
}
if (!/\*\*Active adapter count: \d+\*\*/.test(source[adapters[0]]) || !source[adapters[0]].includes("`canonical-list-dom-roundtrip`")) {
  violations.push("canonical list migration adapter is missing from the tracked metric");
}
if (!/retain the legacy execution path in a \*\*test-only\s+harness before production deletion\*\*/.test(source[behaviorChanges[0]])) {
  violations.push("future shadow-before-delete process rule is missing");
}

if (violations.length) {
  process.stderr.write(`Phase 3 contract violations:\n${violations.map((value) => `- ${value}`).join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Phase 3 pure-command, product-routing, root-promotion, and shadow-policy gates passed.\n");
