import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const classic = read("packages/react/src/components/ClassicEditor.tsx");
const harness = read("packages/react/src/test-harness/legacyInlineEngine.ts");
const declarations = read("packages/core/src/foundation/marks/schema.ts");
const inventory = read("docs/MIGRATION_ADAPTER_INVENTORY.md");

const failures = [];
if (!harness.includes("Test-only Phase 4 snapshot") || !harness.includes("smartrte-core/legacy")) {
  failures.push("Legacy inline engine is not retained in the test-only harness.");
}
for (const id of ["bold", "italic", "underline", "strikethrough", "inlineCode", "superscript", "subscript", "textColor", "backgroundColor", "fontSize", "fontFamily", "link"]) {
  if (!declarations.includes(`id: "${id}"`)) failures.push(`Missing inline tool declaration: ${id}`);
}
const legacyImports = [...classic.matchAll(/import\s+[^;]+from\s+["']smartrte-core\/legacy["']/g)].map((match) => match[0]).join("\n");
if (/\b(?:toggleBold|toggleItalic|toggleUnderline|toggleStrike|applyTextColor|applyFontSize|applyFontFamily|applyLink|removeLink)\b/.test(legacyImports)) {
  failures.push("ClassicEditor still references a legacy inline command.");
}
if (/execCommand\(\s*["'](?:bold|italic|underline|strikeThrough|subscript|superscript|foreColor|hiliteColor|fontName|fontSize|createLink|unlink)["']/.test(classic)) {
  failures.push("ClassicEditor still invokes an inline-formatting execCommand.");
}
const adapterFiles = readdirSync(join(root, "packages/react/src/adapters")).filter((file) => file.endsWith(".ts"));
const markers = adapterFiles.flatMap((file) => [...read(`packages/react/src/adapters/${file}`).matchAll(/MIGRATION_ADAPTER:/g)]).length;
const declaredCount = Number(/Active adapter count:\s*(\d+)/.exec(inventory)?.[1]);
if (markers !== declaredCount) failures.push(`Adapter inventory says ${declaredCount}; source contains ${markers} markers.`);

if (failures.length) {
  failures.forEach((failure) => console.error(`Phase 4 contract: ${failure}`));
  process.exit(1);
}
console.log(`Phase 4 contract: 12 declarations, retained legacy harness, no Classic inline legacy path, ${markers} tracked adapters.`);
