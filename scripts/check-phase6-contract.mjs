import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const commands = read("packages/core/src/foundation/table/commands.ts");
const resolver = read("packages/core/src/foundation/scope/resolveScope.ts");
const classic = read("packages/react/src/components/ClassicEditor.tsx");
const bridge = read("packages/react/src/adapters/domTableCommandBridge.ts");
const harness = read("packages/react/src/test-harness/legacyTableEngine.ts");
const catalogue = read("docs/PHASE6_BEHAVIOR_CHANGE_CATALOGUE.md");
const inventory = read("docs/MIGRATION_ADAPTER_INVENTORY.md");
const failures = [];

if (!resolver.includes("occupancyGridFor(table.node)") || /const (?:build|create)TableGrid/.test(resolver)) failures.push("Phase 2 resolver no longer consumes the shared occupancy grid.");
for (const id of ["insert", "remove", "insertRow", "removeRow", "insertColumn", "removeColumn", "mergeCells", "splitCell", "setHeader", "setCellAttributes", "setColumnWidth", "setRowHeight", "moveRow", "moveColumn"]) {
  if (!commands.includes(`"table.${id}"`)) failures.push(`Missing foundation command table.${id}.`);
}
if (bridge.includes("smartrte-core/legacy") || bridge.includes("createSmartEditor")) failures.push("Product table bridge still invokes the legacy table engine.");
if (/\.rowSpan\s*=|\.colSpan\s*=|createElement\(["'](?:tr|td|th)["']\)/.test(classic)) failures.push("ClassicEditor still contains direct table structural mutation.");
if (!harness.includes("Test-only snapshot") || !harness.includes("smartrte-core/legacy")) failures.push("Legacy table engine was not retained in the test-only harness.");
if (!catalogue.includes("2,100 scenarios") || !catalogue.includes("no semantic, data-loss, or unknown")) failures.push("Phase 6 behavior catalogue is missing the retained-engine corpus result.");
const adapterFiles = readdirSync(join(root, "packages/react/src/adapters")).filter((file) => file.endsWith(".ts"));
const markers = adapterFiles.flatMap((file) => [...read(`packages/react/src/adapters/${file}`).matchAll(/MIGRATION_ADAPTER:/g)]).length;
if (markers !== 3) failures.push(`Feature adapter count is ${markers}; Phase 6 cap is 3.`);

if (failures.length) {
  failures.forEach((failure) => console.error(`Phase 6 contract: ${failure}`));
  process.exit(1);
}
console.log(`Phase 6 contract: shared grid, canonical product routing, retained harness, deleted Classic mutations, ${markers} tracked adapters.`);
