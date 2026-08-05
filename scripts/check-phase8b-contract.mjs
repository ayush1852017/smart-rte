import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path) => readFileSync(path, "utf8");
const failures = [];
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
const authority = read("packages/react/src/components/ClassicEditorAuthority.tsx");
if (!authority.includes("canonicalAuthorityFlag.enabled")) failures.push("Product export does not route through the runtime rollback flag.");
const runtime = read("packages/react/src/canonicalEditorRuntime.ts");
if (!runtime.includes("replaceState") || !runtime.includes("createCheckpoint")) failures.push("Retained runtime lacks explicit replacement/checkpoint ownership.");
if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log("Phase 8b canonical-product authority contract: pass");

