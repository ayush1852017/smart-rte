import { assertContract, mapKeys, readSource, sourceHas } from "./contract-utils.mjs";

const [grid, commands, resolver, classic, canonical, harness] = await Promise.all([
  readSource("packages/core/src/foundation/table/grid.ts"),
  readSource("packages/core/src/foundation/table/commands.ts"),
  readSource("packages/core/src/foundation/scope/resolveScope.ts"),
  readSource("packages/react/src/components/ClassicEditor.tsx"),
  readSource("packages/react/src/components/CanonicalAuthorityEditor.tsx"),
  readSource("packages/react/src/test-harness/legacyTableEngine.ts"),
]);
const failures = [];
if (!sourceHas(grid, /export\s+(?:const|function)\s+occupancyGridFor/)) failures.push("Shared occupancyGridFor implementation is missing.");
if (!sourceHas(resolver, /import\s*\{[^}]*occupancyGridFor[^}]*\}\s*from\s+["']\.\.\/table/)) failures.push("Scope resolver does not consume the shared occupancy grid.");
if (!sourceHas(commands, /import\s*\{\s*occupancyGridFor\s*\}\s*from\s+["']\.\/grid/)) failures.push("Table commands do not consume the shared occupancy grid.");
const expected = ["table.insert", "table.remove", "table.insertRow", "table.removeRow", "table.insertColumn", "table.removeColumn", "table.mergeCells", "table.splitCell", "table.setHeader", "table.setCellAttributes", "table.setColumnWidth", "table.setRowHeight", "table.moveRow", "table.moveColumn"];
const keys = mapKeys(commands, "tableCommands");
for (const key of expected) if (!keys.includes(key)) failures.push(`tableCommands is missing ${key}.`);
if (sourceHas(classic, /\.rowSpan\s*=|\.colSpan\s*=|createElement\(\s*["'](?:tr|td|th)["']\s*\)/)) failures.push("ClassicEditor still performs direct table structural DOM mutation.");
if (!sourceHas(canonical, /insertTableCommand\(|runTable\(/)) failures.push("Canonical surface does not route table operations through foundation commands.");
if (!sourceHas(harness, /executeRetainedLegacyTable\s*=\s*\(/) || !sourceHas(harness, /smartrte-core\/legacy/)) failures.push("Retained table legacy harness is missing.");

if (assertContract("Phase 6 shared-grid", failures)) {
  process.stdout.write(`Phase 6 contract: shared grid consumers, ${keys.length} table commands, canonical routing, and retained harness passed.\n`);
}
