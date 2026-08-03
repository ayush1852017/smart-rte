import { performance } from "node:perf_hooks";
import { createSchema, resolveScope } from "../packages/core/dist/foundation/index.js";

const schema = createSchema({
  version: 2,
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "paragraph", group: "block", content: "inline*" },
    { type: "text", group: "inline" },
    { type: "table", group: "block", content: "table_row+", isolating: true },
    { type: "table_row", group: "block", content: "table_cell+" },
    { type: "table_cell", group: "block", content: "block+", isolating: true },
  ],
});

const paragraph = (id) => ({ type: "paragraph", id, children: [{ type: "text", text: "benchmark" }] });
const blockDocument = (count) => ({
  type: "doc",
  id: "doc",
  children: Array.from({ length: count }, (_, index) => paragraph(`p-${index}`)),
});
const tableDocument = (count) => {
  const columns = 10;
  const rows = Math.ceil(count / columns);
  let next = 0;
  return {
    document: {
      type: "doc", id: "doc", children: [{
        type: "table", id: "table", children: Array.from({ length: rows }, (_, row) => ({
          type: "table_row", id: `row-${row}`, children: Array.from({ length: Math.min(columns, count - next) }, () => {
            const index = next++;
            return { type: "table_cell", id: `cell-${index}`, children: [paragraph(`cell-p-${index}`)] };
          }),
        })),
      }],
    },
    rows,
    lastColumn: (count - 1) % columns,
  };
};

const measure = (run, iterations) => {
  for (let warmup = 0; warmup < 3; warmup += 1) run();
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return {
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    minMs: Number(samples[0].toFixed(3)),
    maxMs: Number(samples[samples.length - 1].toFixed(3)),
  };
};

const results = [];
for (const count of [500, 2_000, 10_000]) {
  const blocks = blockDocument(count);
  const table = tableDocument(count);
  const iterations = count === 500 ? 30 : count === 2_000 ? 15 : 5;
  results.push({
    units: count,
    fullDocumentBlockRange: measure(() => resolveScope(blocks, {
      type: "text", anchor: { path: [], offset: 0 }, head: { path: [], offset: count },
    }, { want: "block-range" }, schema), iterations),
    largeTableGrid: measure(() => resolveScope(table.document, {
      type: "cell",
      anchor: { path: [0, 0, 0, 0], offset: 0 },
      head: { path: [0, table.rows - 1, table.lastColumn, 0], offset: 9 },
    }, { want: "table-grid" }, schema), iterations),
  });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
