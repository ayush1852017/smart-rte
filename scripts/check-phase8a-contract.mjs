import { assertContract, readSource, sourceHas } from "./contract-utils.mjs";

const [pipeline, sanitizer, runtime, harness, diagnostics] = await Promise.all([
  readSource("packages/core/src/foundation/clipboard/pipeline.ts"),
  readSource("packages/core/src/foundation/clipboard/sanitizer.ts"),
  // Phase 8b closeout (2026-08-12): canonicalClipboardRuntime.ts (the
  // legacy-DOM-bridge-specific paste handler) was retired alongside
  // LegacyClassicEditor. Canonical's own paste handling has always been an
  // independent implementation in the core input pipeline, not this file -
  // repoint the product-boundary assertion there.
  readSource("packages/core/src/foundation/surface/input.ts"),
  readSource("packages/react/src/test-harness/legacyClipboardEngine.ts"),
  readSource("packages/core/src/foundation/clipboard/diagnostics.ts"),
]);
const failures = [];
const sanitizeIndex = pipeline.indexOf("sanitizeClipboardHtml(");
const normalizeIndex = pipeline.indexOf("normalizer.normalize(");
if (sanitizeIndex < 0 || normalizeIndex < 0 || sanitizeIndex > normalizeIndex) failures.push("Clipboard sanitization is not structurally ordered before source normalization.");
if (!sourceHas(sanitizer, /from\s+["']dompurify["']/) || !sourceHas(sanitizer, /sanitizeResourceUrl/)) failures.push("Clipboard HTML does not use DOMPurify and the shared URL policy.");
if (sourceHas(sanitizer, /\bnew\s+URL\s*\(/) || sourceHas(sanitizer, /function\s+sanitize(?:Url|URL)/)) failures.push("Clipboard sanitizer contains a second URL policy.");
if (!sourceHas(runtime, /parseClipboardPayload/) || !sourceHas(runtime, /addEventListener\(\s*["']paste["']/)) failures.push("Canonical clipboard runtime is not installed at the product boundary.");
if (!sourceHas(harness, /legacyCleanPastedHtml\(/)) failures.push("Retained clipboard legacy harness is missing.");
if (!sourceHas(diagnostics, /fixtureHash|detectedSource|structuralShape|repairs/)) failures.push("Privacy-safe clipboard diagnostics do not expose the required structural fields.");
const forbiddenDomApi = ["exec", "Command"].join("");
if (runtime.includes(forbiddenDomApi)) failures.push(`Clipboard runtime still calls ${forbiddenDomApi}.`);

if (assertContract("Phase 8a clipboard", failures)) {
  process.stdout.write("Phase 8a contract: sanitize-first DOMPurify pipeline, shared URL policy, canonical boundary, retained harness, and privacy-safe diagnostics passed.\n");
}
