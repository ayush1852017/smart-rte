import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoots = [resolve(repositoryRoot, "packages/core/src"), resolve(repositoryRoot, "packages/react/src")];
const foundationRoot = resolve(repositoryRoot, "packages/core/src/foundation");
const legacyContractNames = new Set([
  "LegacySmartDocument", "LegacySmartMark", "LegacySmartTextNode",
  "LegacySmartSelection", "LegacySmartOperation", "LegacySmartTransaction",
  "LegacySmartSchema", "LegacyCommandContext", "LegacyHistoryEntry",
  "LegacyListSelectionScope",
]);

const files = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
};
await Promise.all(sourceRoots.map(visit));

const violations = [];
for (const file of files) {
  const repositoryPath = relative(repositoryRoot, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  if (repositoryPath.startsWith("packages/core/src/foundation/")) {
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier === "smartrte-core") {
        violations.push(`${repositoryPath}: foundation code may not import the legacy core root`);
      } else if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        if (target !== foundationRoot && !target.startsWith(`${foundationRoot}${sep}`)) {
          violations.push(`${repositoryPath}: relative import "${specifier}" escapes the foundation boundary`);
        }
      }
    }
  }
  const rootImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']smartrte-core["']/gms;
  for (const match of source.matchAll(rootImport)) {
    const imported = match[1].split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    const legacyContracts = imported.filter((name) => legacyContractNames.has(name));
    if (legacyContracts.length) {
      violations.push(`${repositoryPath}: import ${legacyContracts.join(", ")} from smartrte-core/legacy, not the canonical root`);
    }
  }
}

if (violations.length) {
  process.stderr.write(`Foundation boundary violations:\n${violations.map((value) => `- ${value}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Foundation import boundary passed.\n");
}
