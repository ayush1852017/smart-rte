import { assertContract, mapKeys, readSource, sourceHas } from "./contract-utils.mjs";

const [schema, commands, security, lifecycle, persistence, renderer, input, composition, classic, atomBridge, imageBridge, canonical, harness] = await Promise.all([
  readSource("packages/core/src/foundation/atom/schema.ts"),
  readSource("packages/core/src/foundation/atom/commands.ts"),
  readSource("packages/core/src/foundation/atom/security.ts"),
  readSource("packages/core/src/foundation/atom/lifecycle.ts"),
  readSource("packages/core/src/foundation/atom/persistence.ts"),
  readSource("packages/core/src/foundation/surface/renderer.ts"),
  readSource("packages/core/src/foundation/surface/input.ts"),
  readSource("packages/core/src/foundation/atom/composition.ts"),
  readSource("packages/react/src/components/ClassicEditor.tsx"),
  readSource("packages/react/src/adapters/domInlineAtomCommandBridge.ts"),
  readSource("packages/react/src/adapters/domInlineImageCommandBridge.ts"),
  readSource("packages/react/src/components/CanonicalAuthorityEditor.tsx"),
  readSource("packages/react/src/test-harness/legacyAtomEngine.ts"),
]);
const failures = [];
for (const type of ["image", "block_image", "formula", "block_formula", "video", "audio"]) {
  if (!schema.includes(`type: "${type}"`)) failures.push(`Missing atom node spec ${type}.`);
}
const keys = mapKeys(commands, "atomCommands");
for (const key of ["atom.insert", "atom.update", "atom.delete", "atom.resize"]) if (!keys.includes(key)) failures.push(`atomCommands is missing ${key}.`);
if (!sourceHas(security, /sanitizeResourceUrl/)) failures.push("Atom security does not reuse sanitizeResourceUrl.");
if (sourceHas(security, /\bnew\s+URL\s*\(/)) failures.push("Atom security has a second URL policy implementation.");
if (!sourceHas(lifecycle, /addToHistory:\s*false/) || !sourceHas(lifecycle, /positionOf\(nodeId\)/)) failures.push("Async atom completion lacks non-history or stale-ID handling.");
if (!sourceHas(persistence, /Cannot persist transient blob URL/) || !sourceHas(persistence, /Cannot persist pending atom/)) failures.push("Pending/blob persistence guard is missing.");
if (sourceHas([renderer, commands, lifecycle, atomBridge, imageBridge].join("\n"), /createElement\(\s*["']svg["']\s*\)|\.innerHTML\s*=|\beval\s*\(|new\s+Function\s*\(/)) failures.push("Atom production path contains unsafe inline SVG, HTML injection, or evaluation.");
if (!sourceHas(renderer, /contentEditable\s*=\s*["']false["']/) || !sourceHas(renderer, /data-smart-atomic/)) failures.push("Atom renderer is not read-only/atomic.");
if (!sourceHas(composition, /kind:\s*["']atom["']/) || !sourceHas(composition, /token\.kind\s*===\s*["']atom["']/)
  || !sourceHas(input, /unit\.kind\s*===\s*["']atom["']/)) failures.push("Composition is not atom-token aware.");
if (sourceHas(`${atomBridge}\n${imageBridge}`, /smartrte-core\/legacy/)) failures.push("Product atom bridges still import legacy core.");
if (sourceHas(classic, /createElement\(\s*["'](?:img|span)["']\s*\)|fallbackSpan/)) failures.push("ClassicEditor still contains direct atom insertion fallback.");
if (!sourceHas(classic, /trust:\s*false/) || !sourceHas(classic, /strict:\s*["']error["']/)) failures.push("Formula rendering does not disable KaTeX trust.");
if (!sourceHas(canonical, /insertBlockAtom\(|insertInlineFormula\(/)) failures.push("Canonical surface does not route atom insertion.");
if (!sourceHas(harness, /executeRetainedLegacyAtom\s*=\s*\(/) || !sourceHas(harness, /smartrte-core\/legacy/)) failures.push("Retained atom legacy harness is missing.");

if (assertContract("Phase 7 atom-security", failures)) {
  process.stdout.write(`Phase 7 contract: ${keys.length} generic atom commands, lifecycle/persistence/security guards, canonical routing, and retained harness passed.\n`);
}
