import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const pipeline = read("packages/core/src/foundation/clipboard/pipeline.ts");
const sanitizer = read("packages/core/src/foundation/clipboard/sanitizer.ts");
const classic = read("packages/react/src/components/ClassicEditor.tsx");
const runtime = read("packages/react/src/canonicalClipboardRuntime.ts");
const harness = read("packages/react/src/test-harness/legacyClipboardEngine.ts");
const inventory = read("docs/MIGRATION_ADAPTER_INVENTORY.md");
const failures = [];

const sanitizeIndex = pipeline.indexOf("sanitizeClipboardHtml(");
const normalizeIndex = pipeline.indexOf("normalizer.normalize(");
if (sanitizeIndex < 0 || normalizeIndex < 0 || sanitizeIndex > normalizeIndex) {
  failures.push("Clipboard sanitization is not structurally ordered before source normalization.");
}
if (!sanitizer.includes('from "dompurify"') || !sanitizer.includes("sanitizeResourceUrl")) {
  failures.push("Clipboard HTML must use DOMPurify and the shared URL policy.");
}
if (sanitizer.includes("new URL(") || /function\s+sanitize(?:Url|URL)/.test(sanitizer)) {
  failures.push("Clipboard sanitizer contains a third URL policy implementation.");
}
if (/\bonPaste\b|clipboardData|cleanPastedHtml|insertCleanHtml/.test(classic)) {
  failures.push("ClassicEditor still contains clipboard event handling or legacy cleaning.");
}
if (!runtime.includes("parseClipboardPayload") || !runtime.includes('addEventListener("paste"')) {
  failures.push("The product paste boundary is not routed through the canonical pipeline.");
}
if (!harness.includes("Test-only snapshot") || !harness.includes("legacyCleanPastedHtml")) {
  failures.push("The legacy clipboard engine was not retained in the test-only harness.");
}
const adapterFiles = readdirSync(join(root, "packages/react/src/adapters")).filter((file) => file.endsWith(".ts"));
const featureMarkers = adapterFiles.flatMap((file) => [...read(`packages/react/src/adapters/${file}`).matchAll(/MIGRATION_ADAPTER:/g)]).length;
const runtimeMarkers = [...runtime.matchAll(/MIGRATION_ADAPTER:/g)].length;
const markers = featureMarkers + runtimeMarkers;
const declaredCount = Number(/Active adapter count:\s*(\d+)/.exec(inventory)?.[1]);
if (featureMarkers !== 3 || runtimeMarkers !== 1 || markers !== 4 || declaredCount !== 4) {
  failures.push(`Phase 8a adapter count must disclose 3 feature + 1 clipboard bridge; source=${markers}, inventory=${declaredCount}.`);
}
if (!runtime.includes("reportParsedClipboard") || !runtime.includes("reportRejectedClipboard")) {
  failures.push("Product clipboard runtime does not emit privacy-safe parsed/rejected diagnostics.");
}

if (failures.length) {
  failures.forEach((failure) => console.error(`Phase 8a contract: ${failure}`));
  process.exit(1);
}
console.log("Phase 8a contract: sanitize-first DOMPurify pipeline, shared URL policy, privacy-safe diagnostics, retained legacy harness, external canonical product routing, and 4 tracked adapters.");
