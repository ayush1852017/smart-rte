import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  model: resolve(root, "packages/core/src/foundation/types.ts"),
  scope: resolve(root, "packages/core/src/foundation/scope/types.ts"),
  resolver: resolve(root, "packages/core/src/foundation/scope/resolveScope.ts"),
  operations: resolve(root, "packages/core/src/foundation/operations.ts"),
  surface: resolve(root, "packages/core/src/foundation/surface"),
  rootIndex: resolve(root, "packages/core/src/index.ts"),
};
const [model, scope, resolver, operations, rootIndex] = await Promise.all([
  paths.model, paths.scope, paths.resolver, paths.operations, paths.rootIndex,
].map((path) => readFile(path, "utf8")));
const violations = [];

if (!/semanticRole\?:\s*"list"\s*\|\s*"list-item"\s*\|\s*"table"\s*\|\s*"table-row"\s*\|\s*"table-cell"/.test(model)) {
  violations.push("NodeSpec.semanticRole is missing or has drifted");
}
if (/storedMarks\??:/.test(scope)) violations.push("SelectionDescription still exposes storedMarks");
if (/\bclear\(\):\s*void/.test(scope)) violations.push("ScopeIndex exposes forbidden manual invalidation");
if (!/const roleOf =/.test(resolver) || !/semanticRole \?\? fallbackRole/.test(resolver)) {
  violations.push("scope resolution does not use the single semanticRole/type-fallback boundary");
}
if (/let\s+document\s*=\s*cloneNode\(input\)/.test(operations) || !/class PathCopySession/.test(operations)) {
  violations.push("operation apply is not using the persistent path-copy session");
}
if (!/same reference ⇒ unchanged subtree|reference identity/.test(operations)) {
  violations.push("reference identity memoization contract is not documented in apply code");
}
if (!/export \* from "\.\/foundation\/index\.js"/.test(rootIndex)) violations.push("Phase 3 root promotion no longer exports foundation contracts");

const sourceFiles = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) sourceFiles.push(path);
  }
};
await Promise.all([resolve(root, "packages/core/src"), resolve(root, "packages/react/src")].map(visit));
for (const file of sourceFiles) {
  const repositoryPath = relative(root, file).replaceAll("\\", "/");
  if (repositoryPath.startsWith("packages/core/src/foundation/")) continue;
  const source = await readFile(file, "utf8");
  if (/\b(?:positionOf|rangeOf|contentRangeOf)\s*\(\s*nodeId\b/.test(source)) {
    violations.push(`${repositoryPath}: implements an ID-to-position traversal outside foundation`);
  }
}

if (violations.length) {
  process.stderr.write(`Phase 2.5 contract violations:\n${violations.map((value) => `- ${value}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Phase 2.5 amendments, persistent apply, lookup boundary, and standalone-surface scope gates passed.\n");
}
