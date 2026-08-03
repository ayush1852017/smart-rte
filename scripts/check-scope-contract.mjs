import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const typesPath = resolve(repositoryRoot, "packages/core/src/foundation/scope/types.ts");
const indexPath = resolve(repositoryRoot, "packages/core/src/foundation/scope/index.ts");
const resolverPath = resolve(repositoryRoot, "packages/core/src/foundation/scope/resolveScope.ts");
const [types, index, resolver] = await Promise.all([typesPath, indexPath, resolverPath].map((path) => readFile(path, "utf8")));
const violations = [];

if (/\b(?:blockIds|rootId|nodeIds|itemId|listId|tableId|cellIds|nodeId):\s*(?:SmartPos|number\[\])/.test(types)) {
  violations.push("scope structural references must use stable string IDs, never paths");
}
if (/export\s+(?:const|function|class)\s+(?!resolveScope\b)/.test(index)) {
  violations.push("the scope package may export only the read-only resolveScope function plus types");
}
if (/\b(?:apply|insert|delete|remove|replace|move|split|merge|setNode|transact)\w*\s*\(/.test(index)) {
  violations.push("the scope package exports a mutation-shaped API");
}
if (/selection\.(?:anchor|head)\.(?:path|offset)|\b(?:anchor|head)\.(?:path|offset)/.test(resolver)) {
  violations.push("a resolver branches on raw SmartPos fields instead of a resolved endpoint");
}
if (!/const resolveEndpoint =/.test(resolver) || !/kind:\s*entry\.inlineOwner \? "inline" : "structural"/.test(resolver)) {
  violations.push("the shared resolve-before-branch boundary is missing");
}

if (violations.length) {
  process.stderr.write(`Scope contract violations:\n${violations.map((value) => `- ${value}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Scope API, ID-only reference, resolve-before-branch, and read-only export gates passed.\n");
}
