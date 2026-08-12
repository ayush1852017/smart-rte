import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { withoutComments } from "./contract-utils.mjs";

const read = (path) => readFileSync(path, "utf8");
const failures = [];
let repositoryExecCommand = "";
try {
  repositoryExecCommand = execFileSync("rg", [
    "-n", "document\\.execCommand|\\.execCommand\\(", ".",
    "--glob", "!docs/**",
    "--glob", "!scripts/check-phase8b-contract.mjs",
  ], { encoding: "utf8" });
} catch (error) { if (error.status !== 1) throw error; }
if (repositoryExecCommand.trim()) failures.push(`Executable repository paths still contain execCommand:\n${repositoryExecCommand}`);
const product = [
  "packages/core/src",
  "packages/react/src/canonicalEditorRuntime.ts",
  "packages/react/src/components/CanonicalAuthorityEditor.tsx",
  "packages/react/src/components/ClassicEditorAuthority.tsx",
];
const forbidden = ["exec" + "Command", "MIGRATION_" + "ADAPTER"];
for (const path of product) {
  let output = "";
  try { output = execFileSync("rg", ["-n", forbidden.join("|"), path], { encoding: "utf8" }); }
  catch (error) { if (error.status !== 1) throw error; }
  if (output.trim()) failures.push(`${path} contains a forbidden DOM-authority primitive:\n${output}`);
}
// Phase 8b closeout (2026-08-12): the rollback flag was promoted and the
// DOM-authoritative legacy path (LegacyClassicEditor and its four rollback
// bridges) was retired. The product export is now unconditionally canonical
// — there is no remaining legacy renderer to route to or switch away from.
const authority = withoutComments(read("packages/react/src/components/ClassicEditorAuthority.tsx"));
if (!authority.includes("CanonicalAuthorityEditor")) failures.push("Product export does not render the canonical authority editor.");
if (/LegacyClassicEditor|from ["']\.\/ClassicEditor\.js["']/.test(authority)) failures.push("Product export still references the retired legacy editor.");
const runtime = withoutComments(read("packages/react/src/canonicalEditorRuntime.ts"));
if (!runtime.includes("replaceState") || !runtime.includes("createCheckpoint")) failures.push("Retained runtime lacks explicit replacement/checkpoint ownership.");
if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log("Phase 8b canonical-product authority contract: pass");
