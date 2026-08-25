import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { builtInPlugins } from "../packages/core/dist/foundation/index.js";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "docs/plugins");
const checkMode = process.argv.includes("--check");

const renderOptions = (options) => {
  if (!options || !Object.keys(options).length) return "";
  const rows = Object.entries(options)
    .map(([name, spec]) => `| \`${name}\` | ${spec.required ? "yes" : "no"} | ${spec.description} |`)
    .join("\n");
  return `\n**Options:**\n\n| Name | Required | Description |\n|---|---|---|\n${rows}\n`;
};

const renderExamples = (examples) => {
  if (!examples?.length) return "";
  const items = examples.map((example) => `- ${example.description}: \`${JSON.stringify(example.params)}\`${example.expectedOutcome ? ` -> ${example.expectedOutcome}` : ""}`).join("\n");
  return `\n**Examples:**\n\n${items}\n`;
};

const renderCommand = (command) => `### \`${command.id}\`\n\n${command.description}\n${renderOptions(command.options)}${renderExamples(command.examples)}`;

const renderPlugin = (plugin) => {
  const commands = Object.values(plugin.commands).sort((left, right) => left.id.localeCompare(right.id));
  const header = `# ${plugin.id} plugin\n\n`;
  const meta = `**Version:** ${plugin.version}${plugin.requires?.length ? `  \n**Requires:** ${plugin.requires.join(", ")}` : ""}${plugin.optional?.length ? `  \n**Optional:** ${plugin.optional.join(", ")}` : ""}\n\n`;
  const body = commands.length
    ? commands.map(renderCommand).join("\n\n")
    : "_No commands registered yet._\n";
  return `${header}${meta}${body}\n`;
};

const failures = [];
builtInPlugins.forEach((plugin) => {
  Object.values(plugin.commands).forEach((command) => {
    if (!command.description || !command.description.trim()) {
      failures.push(`Plugin "${plugin.id}" command "${command.id}" has no description.`);
    }
  });
});
if (failures.length) {
  process.stderr.write(`Plugin doc generation failed:\n${failures.map((f) => `- ${f}`).join("\n")}\n`);
  process.exitCode = 1;
  process.exit();
}

const generated = new Map(builtInPlugins.map((plugin) => [`${plugin.id}.md`, renderPlugin(plugin)]));

if (checkMode) {
  const existingFiles = await readdir(outDir).catch(() => []);
  const staleness = [];
  for (const [file, content] of generated) {
    const existing = await readFile(resolve(outDir, file), "utf8").catch(() => null);
    if (existing !== content) staleness.push(`docs/plugins/${file} is stale or missing - run 'node scripts/generate-plugin-docs.mjs'.`);
  }
  const extra = existingFiles.filter((file) => file.endsWith(".md") && !generated.has(file));
  extra.forEach((file) => staleness.push(`docs/plugins/${file} no longer corresponds to a registered plugin - remove it or regenerate.`));
  if (staleness.length) {
    process.stderr.write(`Plugin docs are stale:\n${staleness.map((s) => `- ${s}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Plugin docs contract: ${generated.size} plugin doc(s) up to date.\n`);
  }
} else {
  await mkdir(outDir, { recursive: true });
  for (const [file, content] of generated) await writeFile(resolve(outDir, file), content);
  process.stdout.write(`Generated ${generated.size} plugin doc(s) in docs/plugins/.\n`);
}
