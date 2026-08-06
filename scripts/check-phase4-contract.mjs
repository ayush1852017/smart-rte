import { assertContract, mapKeys, readSource, sourceHas, withoutComments } from "./contract-utils.mjs";

const [schema, commands, classic, canonical, harness] = await Promise.all([
  readSource("packages/core/src/foundation/marks/schema.ts"),
  readSource("packages/core/src/foundation/marks/commands.ts"),
  readSource("packages/react/src/components/ClassicEditor.tsx"),
  readSource("packages/react/src/components/CanonicalAuthorityEditor.tsx"),
  readSource("packages/react/src/test-harness/legacyInlineEngine.ts"),
]);
const failures = [];
const schemaSource = withoutComments(schema);
const commandSource = withoutComments(commands);
const toolBlock = schemaSource.match(/export\s+const\s+inlineToolDeclarations\s*=\s*\[([\s\S]*?)\]\s*as\s+const/)?.[1] || "";
const toolIds = [...toolBlock.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
const expectedTools = ["bold", "italic", "underline", "strikethrough", "inlineCode", "superscript", "subscript", "textColor", "backgroundColor", "fontSize", "fontFamily", "link"];
if (toolIds.length !== expectedTools.length || expectedTools.some((id) => !toolIds.includes(id))) {
  failures.push(`Expected exactly ${expectedTools.length} generic inline tool declarations; found ${toolIds.length}: ${toolIds.join(", ")}.`);
}
for (const key of ["mark.apply", "mark.remove", "mark.toggle", "mark.setAttrs", "mark.clearAll"]) {
  if (!mapKeys(commands, "markCommands").includes(key)) failures.push(`markCommands is missing ${key}.`);
}
if (!sourceHas(commands, /export\s+const\s+(?:applyMarkCommand|removeMarkCommand|toggleMarkCommand|setMarkAttrsCommand|clearAllMarksCommand)/)) {
  failures.push("Generic mark command implementation is missing.");
}
if (sourceHas(classic, /document\.execCommand\s*\(/)) failures.push("ClassicEditor still invokes execCommand for inline formatting.");
if (!sourceHas(canonical, /executeMarkTool\(/)) failures.push("Canonical surface does not route marks through the generic mark engine.");
if (!sourceHas(harness, /runLegacyInlineTool\(|legacyInlineToolIds/) || !sourceHas(harness, /smartrte-core\/legacy/)) failures.push("Retained inline legacy harness is missing.");

if (assertContract("Phase 4 generic-mark", failures)) {
  process.stdout.write(`Phase 4 contract: ${toolIds.length} declarations, generic mark command map, canonical routing, and retained harness passed.\n`);
}
