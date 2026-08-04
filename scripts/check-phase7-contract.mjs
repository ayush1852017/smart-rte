import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const schema = read("packages/core/src/foundation/atom/schema.ts");
const commands = read("packages/core/src/foundation/atom/commands.ts");
const security = read("packages/core/src/foundation/atom/security.ts");
const lifecycle = read("packages/core/src/foundation/atom/lifecycle.ts");
const persistence = read("packages/core/src/foundation/atom/persistence.ts");
const renderer = read("packages/core/src/foundation/surface/renderer.ts");
const input = read("packages/core/src/foundation/surface/input.ts");
const classic = read("packages/react/src/components/ClassicEditor.tsx");
const atomBridge = read("packages/react/src/adapters/domInlineAtomCommandBridge.ts");
const imageBridge = read("packages/react/src/adapters/domInlineImageCommandBridge.ts");
const harness = read("packages/react/src/test-harness/legacyAtomEngine.ts");
const inventory = read("docs/MIGRATION_ADAPTER_INVENTORY.md");
const failures = [];

for (const type of ["image", "block_image", "formula", "block_formula", "video", "audio"]) {
  if (!schema.includes(`type: "${type}"`)) failures.push(`Missing atom node spec ${type}.`);
}
for (const id of ["insert", "update", "delete", "resize"]) if (!commands.includes(`"atom.${id}"`)) failures.push(`Missing generic command atom.${id}.`);
if (!security.includes('sanitizeResourceUrl') || security.includes("new URL(")) failures.push("Atom security does not reuse the Phase 4 foundation URL policy.");
if (!lifecycle.includes("addToHistory: false") || !lifecycle.includes("positionOf(nodeId)")) failures.push("Async completion lost its non-history/stale-ID contract.");
if (!persistence.includes("Cannot persist transient blob URL") || !persistence.includes("Cannot persist pending atom")) failures.push("Pending/blob persistence guard is missing.");
if (/createElement\(["']svg["']\)|\.innerHTML\s*=|\beval\s*\(|new Function\s*\(/.test([renderer, commands, lifecycle, atomBridge, imageBridge].join("\n"))) failures.push("Atom production path contains inline SVG, innerHTML, or evaluation.");
if (!renderer.includes('contentEditable = "false"') || !renderer.includes('data-smart-atomic')) failures.push("Atom renderer is not read-only/atomic.");
if (!input.includes("Atoms are opaque composition boundaries") || !input.includes('unit.kind === "atom"')) failures.push("Composition is not atom-token aware.");
if (atomBridge.includes("smartrte-core/legacy") || imageBridge.includes("smartrte-core/legacy")) failures.push("Product atom bridges still invoke legacy core.");
if (/createElement\(["'](?:img|span)["']\)/.test(classic) || classic.includes("fallbackSpan")) failures.push("ClassicEditor still contains direct image/formula insertion fallback.");
if (!classic.includes('trust: false') || !classic.includes('strict: "error"')) failures.push("Formula rendering does not explicitly disable KaTeX trust.");
if (!harness.includes("Test-only snapshot") || !harness.includes("smartrte-core/legacy")) failures.push("Legacy atom engine was not retained test-only.");
if (!read("docs/PHASE8_CANONICAL_AUTHORITY_PLAN.md").includes("3 -> 2 -> 1 -> 0")) failures.push("Phase 8 adapter-removal sequence is not documented.");
const adapterFiles = readdirSync(join(root, "packages/react/src/adapters")).filter((file) => file.endsWith(".ts"));
const markers = adapterFiles.flatMap((file) => [...read(`packages/react/src/adapters/${file}`).matchAll(/MIGRATION_ADAPTER:/g)]).length;
if (markers !== 3) failures.push(`Feature adapter count is ${markers}; Phase 7 cap is 3.`);

if (failures.length) { failures.forEach((failure) => console.error(`Phase 7 contract: ${failure}`)); process.exit(1); }
console.log(`Phase 7 contract: generic atoms, async/persistence/security guards, canonical product routing, retained harness, and ${markers} tracked adapters.`);
