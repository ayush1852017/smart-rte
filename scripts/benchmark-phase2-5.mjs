import { performance } from "node:perf_hooks";
import {
  applyOperation,
  createScopeIndex,
  foundationSchema,
  resolveScope,
} from "../packages/core/dist/foundation/index.js";

const paragraph = (id) => ({ type: "paragraph", id, children: [{ type: "text", text: "benchmark" }] });
const documentOf = (count) => ({ type: "doc", id: "doc", children: Array.from({ length: count }, (_, index) => paragraph(`p-${index}`)) });
const measure = (run, iterations) => {
  for (let warmup = 0; warmup < 5; warmup += 1) run();
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    run();
    values.push(performance.now() - start);
  }
  values.sort((left, right) => left - right);
  return {
    medianMs: Number(values[Math.floor(values.length / 2)].toFixed(4)),
    p95Ms: Number(values[Math.floor(values.length * 0.95)].toFixed(4)),
  };
};

const results = [];
for (const count of [500, 2_000, 10_000]) {
  const document = documentOf(count);
  const block = Math.floor(count / 2);
  const selection = { type: "text", anchor: { path: [block], offset: 4 }, head: { path: [block], offset: 4 } };
  const operation = { type: "insertText", pos: selection.head, text: "x" };
  const cache = createScopeIndex();
  cache.resolve(document, selection, { want: "describe" }, foundationSchema);
  const iterations = count === 10_000 ? 100 : 500;
  let evolving = document;
  let evolvingOffset = 4;
  const incrementalSamples = [];
  for (let index = 0; index < Math.min(iterations, 100); index += 1) {
    evolving = applyOperation(evolving, { type: "insertText", pos: { path: [block], offset: evolvingOffset++ }, text: "x" });
    const currentSelection = { type: "text", anchor: { path: [block], offset: evolvingOffset }, head: { path: [block], offset: evolvingOffset } };
    const start = performance.now();
    cache.resolve(evolving, currentSelection, { want: "describe" }, foundationSchema);
    incrementalSamples.push(performance.now() - start);
  }
  incrementalSamples.sort((left, right) => left - right);
  results.push({
    blocks: count,
    persistentApply: measure(() => applyOperation(document, operation), iterations),
    coldCollapsedDescribe: measure(() => resolveScope(document, selection, { want: "describe" }, foundationSchema), Math.min(iterations, 100)),
    warmCollapsedDescribe: measure(() => cache.resolve(document, selection, { want: "describe" }, foundationSchema), iterations),
    firstResolveAfterEdit: {
      medianMs: Number(incrementalSamples[Math.floor(incrementalSamples.length / 2)].toFixed(4)),
      p95Ms: Number(incrementalSamples[Math.floor(incrementalSamples.length * 0.95)].toFixed(4)),
    },
  });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
