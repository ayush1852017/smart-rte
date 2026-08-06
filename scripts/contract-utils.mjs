import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");

export const readSource = async (relativePath) => readFile(resolve(root, relativePath), "utf8");

/** Remove comments before source-shape checks so documentation cannot satisfy a gate. */
export const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\r\n]*/gm, "$1");

export const sourceHas = (source, expression) => expression.test(withoutComments(source));

export const mapKeys = (source, exportName) => {
  const body = withoutComments(source).match(new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+const`))?.[1] || "";
  return [...body.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]);
};

export const assertContract = (label, failures) => {
  if (failures.length) {
    process.stderr.write(`${label} contract violations:\n${failures.map((value) => `- ${value}`).join("\n")}\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
};
