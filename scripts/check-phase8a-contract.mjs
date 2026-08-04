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
const markers = adapterFiles.flatMap((file) => [...read(`packages/react/src/adapters/${file}`).matchAll(/MIGRATION_ADAPTER:/g)]).length;
const declaredCount = Number(/Active adapter count:\s*(\d+)/.exec(inventory)?.[1]);
if (markers !== 3 || declaredCount !== 3) failures.push(`Phase 8a adapter count must remain 3; source=${markers}, inventory=${declaredCount}.`);

if (failures.length) {
  failures.forEach((failure) => console.error(`Phase 8a contract: ${failure}`));
  process.exit(1);
}
console.log("Phase 8a contract: sanitize-first DOMPurify pipeline, shared URL policy, retained legacy harness, external canonical product routing, and 3 tracked adapters.");
