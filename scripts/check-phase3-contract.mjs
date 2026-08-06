import { assertContract, mapKeys, readSource, sourceHas, withoutComments } from "./contract-utils.mjs";

const [types, commands, canonicalEditor, classic, shadow, harness, rootIndex, legacyIndex, corePackage] = await Promise.all([
  readSource("packages/core/src/foundation/list/types.ts"),
  readSource("packages/core/src/foundation/list/commands.ts"),
  readSource("packages/react/src/components/CanonicalAuthorityEditor.tsx"),
  readSource("packages/react/src/components/ClassicEditor.tsx"),
  readSource("packages/core/src/foundation/list/shadow.ts"),
  readSource("packages/react/src/adapters/legacyListShadowComparator.ts"),
  readSource("packages/core/src/index.ts"),
  readSource("packages/core/src/legacy/index.ts"),
  readSource("packages/core/package.json"),
]);
const failures = [];
const commandSource = withoutComments(commands);
const typeSource = withoutComments(types);
const requiredCommands = [
  "list.create", "list.unwrap", "list.indent", "list.outdent", "list.setPreset", "list.setStyle",
  "list.setChecked", "list.move", "list.restartNumbering", "list.continueNumbering",
];

if (!/export\s+type\s+ListCommand<P>\s*=\s*\(\s*document:\s*SmartDocument,\s*scope:\s*ResolvedScope,\s*params:\s*P,\s*ctx:\s*CommandContext,?\s*\)\s*=>\s*SmartOperation\[\]/s.test(typeSource)) {
  failures.push("ListCommand is not the pure (document, scope, params, ctx) => SmartOperation[] contract.");
}
if (/from\s+["'](?:react|smartrte-core\/legacy)["']|\b(?:HTMLElement|Document|window|FoundationEditor|SmartTransaction)\b/.test(commandSource)) {
  failures.push("List command implementation imports or constructs product/DOM/editor authority.");
}
const keys = mapKeys(commands, "listCommands");
for (const key of requiredCommands) if (!keys.includes(key)) failures.push(`listCommands is missing ${key}.`);
if (!sourceHas(canonicalEditor, /createList\(|indentList\(|outdentList\(|moveListItems\(/)) {
  failures.push("Canonical product toolbar does not call the foundation list commands.");
}
if (sourceHas(classic, /(?:nestSelectedListItems|outdentSelectedListItems|legacyToggleList|legacyIndentListItems|legacyOutdentListItems)/)) {
  failures.push("ClassicEditor still contains a legacy list mutation call.");
}
if (!sourceHas(shadow, /normalizedStructureWithoutIds|semanticSelectionPosition|shadowLogRecord/)) {
  failures.push("List shadow comparator does not compare normalized structure and semantic selection.");
}
if (!sourceHas(harness, /Test-only|smartrte-core\/legacy/)) failures.push("Retained list engine harness is missing.");
if (!sourceHas(rootIndex, /export\s+\*\s+from\s+["']\.\/foundation\/index\.js["']/)) failures.push("Root canonical foundation export is missing.");
if (!sourceHas(legacyIndex, /export\s+\*\s+from\s+["']\.\.\/model\.js["']/)
  || !sourceHas(legacyIndex, /export\s+\*\s+from\s+["']\.\.\/transaction\.js["']/)
  || !corePackage.includes('"./legacy"')) failures.push("Legacy compatibility subpath is missing.");

if (assertContract("Phase 3 pure-command/routing", failures)) {
  process.stdout.write(`Phase 3 contract: ${keys.length} mapped list commands, pure command source, canonical routing, and retained shadow harness passed.\n`);
}
