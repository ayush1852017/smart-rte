import { describe, expect, it } from "vitest";
import {
  createSchema,
  createScopeIndex,
  inlineGraphemeBoundaries,
  resolveScope as resolveScopeCold,
  type ScopeRequest,
  type SmartDocument,
  type SmartElementNode,
  type SmartPos,
  type SmartSchema,
  type SmartSelection,
} from "../index.js";

const phase2Index = createScopeIndex();
const resolveScope = (...args: Parameters<typeof resolveScopeCold>) => phase2Index.resolve(...args);

const schema = createSchema({
  version: 2,
  nodes: [
    { type: "doc", group: "document", content: "block+" },
    { type: "paragraph", group: "block", content: "inline*" },
    { type: "heading", group: "block", content: "inline*" },
    { type: "text", group: "inline" },
    { type: "inline_atom", group: "inline", atomic: true, selectable: true },
    { type: "block_atom", group: "block", atomic: true, selectable: true },
    { type: "list", group: "block", content: "list_item+" },
    { type: "list_item", group: "block", content: "paragraph list*" },
    { type: "table", group: "block", content: "table_row+", isolating: true },
    { type: "table_row", group: "block", content: "table_cell+" },
    { type: "table_cell", group: "block", content: "block+", isolating: true, attributes: {
      rowspan: { default: 1, validate: Number.isInteger },
      colspan: { default: 1, validate: Number.isInteger },
    } },
  ],
  marks: [{ type: "bold" }, { type: "italic" }],
});

const p = (id: string, text = "abc", children?: SmartElementNode["children"]): SmartElementNode => ({
  type: "paragraph", id, children: children ?? (text ? [{ type: "text", text }] : []),
});
const selection = (anchor: SmartPos, head: SmartPos = anchor, type: SmartSelection["type"] = "text"): SmartSelection => ({ anchor, head, type });
const reverse = (value: SmartSelection): SmartSelection => ({ ...value, anchor: value.head, head: value.anchor });
const json = (value: unknown) => JSON.stringify(value);
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
};

const basicDocument = (): SmartDocument => ({
  type: "doc", id: "doc", children: [p("p1", "abc"), p("p2", "def"), p("empty", "")],
});

const tableDocument = (): SmartDocument => ({
  type: "doc", id: "doc", children: [
    p("before", "before"),
    { type: "table", id: "table", children: [
      { type: "table_row", id: "r1", children: [
        { type: "table_cell", id: "a", attrs: { rowspan: 2 }, children: [p("pa", "a")] },
        { type: "table_cell", id: "b", children: [p("pb", "b")] },
      ] },
      { type: "table_row", id: "r2", children: [
        { type: "table_cell", id: "c", children: [p("pc", "c")] },
      ] },
    ] },
    p("after", "after"),
  ],
});

const allRequests: ScopeRequest[] = [
  { want: "inline-range" },
  { want: "block-range" },
  { want: "container-tree" },
  { want: "list-selection" },
  { want: "table-grid" },
  { want: "atomic-node" },
  { want: "describe" },
];

describe("Phase 2 universal scope rules", () => {
  it("resolves every request type totally for collapsed and non-collapsed valid selections", () => {
    const document = basicDocument();
    for (const request of allRequests) {
      expect(() => resolveScope(document, selection({ path: [0], offset: 1 }), request, schema)).not.toThrow();
      expect(() => resolveScope(document, selection({ path: [0], offset: 1 }, { path: [1], offset: 2 }), request, schema)).not.toThrow();
    }
  });

  it("runs 2,500 reverse-selection property cases (seed 0x5C0FE202)", () => {
    const corpus = Array.from({ length: 16 }, (_, variant) => {
      const prefix = `${variant}-नमस्ते`;
      const document: SmartDocument = { type: "doc", id: `doc-${variant}`, children: [
        p(`lead-${variant}`, "", [{ type: "text", text: prefix }, { type: "inline_atom", id: `atom-${variant}` }, { type: "text", text: "👨‍👩‍👧‍👦" }]),
        p(`plain-${variant}`, `plain-${variant}`),
        { type: "list", id: `list-${variant}`, children: [
          { type: "list_item", id: `item-a-${variant}`, children: [p(`item-p-a-${variant}`, "alpha")] },
          { type: "list_item", id: `item-b-${variant}`, children: [p(`item-p-b-${variant}`, "beta")] },
        ] },
        { type: "table", id: `table-${variant}`, children: [{ type: "table_row", id: `row-${variant}`, children: [
          { type: "table_cell", id: `cell-a-${variant}`, children: [p(`cell-p-a-${variant}`, "cell-a")] },
          { type: "table_cell", id: `cell-b-${variant}`, children: [p(`cell-p-b-${variant}`, "cell-b")] },
        ] }] },
        p(`tail-${variant}`, "tail"),
      ] };
      const points: Array<{ path: number[]; limit: number }> = [
        { path: [0], limit: prefix.length + 1 + "👨‍👩‍👧‍👦".length },
        { path: [1], limit: `plain-${variant}`.length },
        { path: [2, 0, 0], limit: 5 }, { path: [2, 1, 0], limit: 4 },
        { path: [3, 0, 0, 0], limit: 6 }, { path: [3, 0, 1, 0], limit: 6 },
        { path: [4], limit: 4 },
      ];
      return { document, points };
    });
    let state = 0x5C0FE202;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (let run = 0; run < 2_500; run += 1) {
      const fixture = corpus[Math.floor(random() * corpus.length)];
      const first = fixture.points[Math.floor(random() * fixture.points.length)];
      const second = fixture.points[Math.floor(random() * fixture.points.length)];
      const from = { path: first.path, offset: Math.floor(random() * (first.limit + 1)) };
      const to = { path: second.path, offset: Math.floor(random() * (second.limit + 1)) };
      const value = selection(from, to);
      for (const request of allRequests) {
        expect(json(resolveScope(fixture.document, value, request, schema))).toBe(json(resolveScope(fixture.document, reverse(value), request, schema)));
      }
    }
  });

  it("is pure on deeply frozen input for every resolver and deterministic across 100 calls", () => {
    const document = deepFreeze(tableDocument());
    const value = selection({ path: [1, 0, 0, 0], offset: 0 }, { path: [1, 1, 0, 0], offset: 1 }, "cell");
    for (const request of allRequests) {
      const first = json(resolveScope(document, value, request, schema));
      for (let repeat = 0; repeat < 100; repeat += 1) expect(json(resolveScope(document, value, request, schema))).toBe(first);
    }
  });

  it("applies the uniform endpoint boundary matrix", () => {
    const document = basicDocument();
    const block = (value: SmartSelection) => resolveScope(document, value, { want: "block-range" }, schema);
    expect(block(selection({ path: [0], offset: 1 }, { path: [1], offset: 0 }))).toMatchObject({ blockIds: ["p1"] });
    expect(block(selection({ path: [0], offset: 0 }, { path: [0], offset: 3 }))).toMatchObject({ blockIds: ["p1"], promotedFromPartial: false });
    expect(block(selection({ path: [0], offset: 0 }))).toMatchObject({ blockIds: ["p1"] });
    expect(block(selection({ path: [0], offset: 3 }))).toMatchObject({ blockIds: ["p1"] });
    expect(block(selection({ path: [2], offset: 0 }))).toMatchObject({ blockIds: ["empty"] });
  });
});

describe("Phase 2 inline, block, container, list, and atom scopes", () => {
  it("keeps inline partial ranges, promotes complete blocks, and computes common parents", () => {
    const document = basicDocument();
    expect(resolveScope(document, selection({ path: [0], offset: 1 }, { path: [1], offset: 2 }), { want: "inline-range" }, schema)).toMatchObject({
      kind: "inline-range",
      runs: [
        { ownerNodeId: "p1", from: 1, to: 3, containsAtoms: false },
        { ownerNodeId: "p2", from: 0, to: 2, containsAtoms: false },
      ],
    });
    expect(resolveScope(document, selection({ path: [0], offset: 1 }, { path: [1], offset: 2 }), { want: "block-range" }, schema)).toMatchObject({
      kind: "block-range", blockIds: ["p1", "p2"], promotedFromPartial: true, commonParentId: "doc",
    });
  });

  it("uses a stopAt ceiling for container trees and enumerates complete subtrees in preorder", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "list", id: "list", children: [{
      type: "list_item", id: "item", children: [p("inside")],
    }] }] };
    expect(resolveScope(document, selection({ path: [0, 0, 0], offset: 1 }), {
      want: "container-tree", stopAt: (node) => node.type === "list_item",
    }, schema)).toMatchObject({ kind: "container-tree", rootId: "item", nodeIds: ["item", "inside"], promotedFromPartial: true });
  });

  it("resolves nested list items with depth, child-list state, and partial subtree truth", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "list", id: "outer", children: [
      { type: "list_item", id: "i1", children: [p("p1"), { type: "list", id: "inner", children: [
        { type: "list_item", id: "i2", children: [p("p2")] },
      ] }] },
      { type: "list_item", id: "i3", children: [p("p3")] },
    ] }] };
    expect(resolveScope(document, selection({ path: [0, 0, 0], offset: 1 }), { want: "list-selection" }, schema)).toMatchObject({
      kind: "list-selection", listId: "outer", items: [{ itemId: "i1", depth: 0, hasChildList: true }], partialSubtree: true,
      promotedFromPartial: true,
    });
    expect(resolveScope(document, selection({ path: [0, 0, 1, 0, 0], offset: 0 }), { want: "list-selection" }, schema)).toMatchObject({
      kind: "list-selection", listId: "inner", items: [{ itemId: "i2", depth: 0, hasChildList: false }],
    });
    expect(resolveScope(document, selection({ path: [0, 0, 0], offset: 0 }, { path: [0, 0, 1, 0, 0], offset: 3 }), { want: "list-selection" }, schema)).toMatchObject({
      kind: "list-selection",
      listId: "outer",
      items: [
        { itemId: "i1", depth: 0, hasChildList: true },
        { itemId: "i2", depth: 1, hasChildList: false },
      ],
      partialSubtree: false,
    });

    const mixed: SmartDocument = { ...document, children: [...document.children, p("plain-after", "plain")] };
    expect(resolveScope(mixed, selection({ path: [0, 1, 0], offset: 1 }, { path: [1], offset: 2 }), { want: "list-selection" }, schema)).toMatchObject({
      kind: "mixed",
      parts: [
        { kind: "list-selection", listId: "outer", items: [{ itemId: "i3", depth: 0, hasChildList: false }] },
        { kind: "block-range", blockIds: ["plain-after"] },
      ],
    });
  });

  it("treats inline atoms as one unit and block atoms as complete blocks", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [
      p("p", "", [
        { type: "text", text: "e" },
        { type: "inline_atom", id: "formula" },
        { type: "text", text: "\u0301x" },
        { type: "inline_atom", id: "formula-2" },
      ]),
      { type: "block_atom", id: "image" },
    ] };
    expect(resolveScope(document, selection({ path: [0], offset: 1 }, { path: [0], offset: 2 }), { want: "atomic-node" }, schema)).toMatchObject({
      kind: "atomic-node", nodeId: "formula", inline: true,
    });
    expect(resolveScope(document, selection({ path: [0], offset: 0 }, { path: [0], offset: 4 }), { want: "inline-range" }, schema)).toMatchObject({
      runs: [{ ownerNodeId: "p", from: 0, to: 4, containsAtoms: true }],
    });
    expect(resolveScope(document, selection({ path: [], offset: 1 }, { path: [], offset: 2 }, "node"), { want: "atomic-node" }, schema)).toMatchObject({
      kind: "atomic-node", nodeId: "image", inline: false,
    });
    expect(resolveScope(document, selection({ path: [], offset: 1 }, { path: [], offset: 2 }), { want: "block-range" }, schema)).toMatchObject({ blockIds: ["image"] });
    expect(() => resolveScope(document, selection({ path: [0, 1], offset: 0 }), { want: "inline-range" }, schema)).toThrow("cannot resolve inside an atomic node");
    const inlineChildren = (document.children[0] as SmartElementNode).children || [];
    expect(inlineGraphemeBoundaries(inlineChildren)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(inlineGraphemeBoundaries([{ type: "text", text: "e\u0301" }])).toEqual([0, 2]);

    const atomMatrix: Array<{ document: SmartDocument; ranges: Array<[number, number, string]> }> = [
      {
        document: { type: "doc", id: "edge-doc", children: [p("edge-p", "", [
          { type: "inline_atom", id: "at-start" }, { type: "text", text: "x" }, { type: "inline_atom", id: "at-end" },
        ])] },
        ranges: [[0, 1, "at-start"], [2, 3, "at-end"]],
      },
      {
        document: { type: "doc", id: "adjacent-doc", children: [p("adjacent-p", "", [
          { type: "inline_atom", id: "adjacent-a" }, { type: "inline_atom", id: "adjacent-b" },
        ])] },
        ranges: [[0, 1, "adjacent-a"], [1, 2, "adjacent-b"]],
      },
      {
        document: { type: "doc", id: "sole-doc", children: [p("sole-p", "", [{ type: "inline_atom", id: "sole" }])] },
        ranges: [[0, 1, "sole"]],
      },
    ];
    atomMatrix.forEach((fixture) => fixture.ranges.forEach(([from, to, nodeId]) => {
      expect(resolveScope(fixture.document, selection({ path: [0], offset: from }, { path: [0], offset: to }), { want: "atomic-node" }, schema)).toMatchObject({
        kind: "atomic-node", nodeId, inline: true,
      });
    }));
  });
});

describe("Phase 2 isolating and table-grid contract", () => {
  it("covers the isolation matrix and reports every clamp", () => {
    const document = tableDocument();
    const cases: SmartSelection[] = [
      selection({ path: [1, 0, 0, 0], offset: 0 }, { path: [2], offset: 2 }),
      selection({ path: [1, 0, 0, 0], offset: 0 }, { path: [1, 0, 1, 0], offset: 1 }),
      selection({ path: [0], offset: 2 }, { path: [1, 0, 1, 0], offset: 1 }),
    ];
    for (const value of cases) {
      expect(resolveScope(document, value, { want: "block-range" }, schema)).toMatchObject({ clamped: true, clampReason: "isolating" });
    }
    const cellClamp = resolveScope(document, cases[1], { want: "block-range" }, schema);
    expect(cellClamp).toMatchObject({ isolatingAncestorId: "b", blockIds: ["pb"] });

    const nestedSchema = createSchema({
      version: 3,
      nodes: [...Object.values(schema.nodes), { type: "island", group: "block", content: "block+", isolating: true }],
      marks: Object.values(schema.marks),
    });
    const nested: SmartDocument = { type: "doc", id: "doc", children: [{ type: "island", id: "outer", children: [
      p("outer-p"), { type: "island", id: "inner", children: [p("nested-p")] },
    ] }, p("outside")] };
    expect(resolveScope(nested, selection({ path: [0, 0], offset: 1 }, { path: [0, 1, 0], offset: 1 }), { want: "block-range" }, nestedSchema)).toMatchObject({
      clamped: true, clampReason: "isolating", isolatingAncestorId: "inner", blockIds: ["nested-p"],
    });

    const nestedTable: SmartDocument = { type: "doc", id: "doc", children: [{ type: "table", id: "outer-table", children: [
      { type: "table_row", id: "outer-row", children: [{ type: "table_cell", id: "outer-cell", children: [
        p("outer-before"), { type: "table", id: "inner-table", children: [{ type: "table_row", id: "inner-row", children: [
          { type: "table_cell", id: "inner-cell", children: [p("inner-p")] },
        ] }] },
      ] }] },
    ] }] };
    expect(resolveScope(nestedTable, selection(
      { path: [0, 0, 0, 0], offset: 1 },
      { path: [0, 0, 0, 1, 0, 0, 0], offset: 1 },
    ), { want: "block-range" }, schema)).toMatchObject({
      clamped: true, clampReason: "isolating", isolatingAncestorId: "inner-cell", blockIds: ["inner-p"],
    });
  });

  it("lets table-grid cross sibling cells while block-range clamps", () => {
    const document = tableDocument();
    const value = selection({ path: [1, 0, 0, 0], offset: 0 }, { path: [1, 1, 0, 0], offset: 1 }, "cell");
    expect(resolveScope(document, value, { want: "block-range" }, schema)).toMatchObject({ clamped: true, blockIds: ["pc"] });
    expect(resolveScope(document, value, { want: "table-grid" }, schema)).toMatchObject({
      kind: "table-grid",
      tableId: "table",
      rect: { top: 0, left: 0, bottom: 1, right: 1 },
      cellIds: ["a", "b", "c"],
      coveredCellIds: [],
      rectangular: true,
      clamped: false,
    });
  });

  it("reports covered spanning cells and non-rectangular grids without expanding them", () => {
    const document = tableDocument();
    const value = selection({ path: [1, 0, 1, 0], offset: 0 }, { path: [1, 1, 0, 0], offset: 1 }, "cell");
    expect(resolveScope(document, value, { want: "table-grid" }, schema)).toMatchObject({
      rect: { top: 0, left: 1, bottom: 1, right: 1 },
      cellIds: ["b", "c"],
      coveredCellIds: [],
      rectangular: true,
    });

    const coveredDocument: SmartDocument = { type: "doc", id: "doc", children: [{ type: "table", id: "table", children: [
      { type: "table_row", id: "r0", children: [
        { type: "table_cell", id: "span", attrs: { rowspan: 2 }, children: [p("ps")] },
        { type: "table_cell", id: "top", children: [p("pt")] },
      ] },
      { type: "table_row", id: "r1", children: [{ type: "table_cell", id: "bottom", children: [p("pb")] }] },
      { type: "table_row", id: "r2", children: [
        { type: "table_cell", id: "low-left", children: [p("pll")] },
        { type: "table_cell", id: "low-right", children: [p("plr")] },
      ] },
    ] }] };
    const nonRectangular = selection({ path: [0, 1, 0, 0], offset: 0 }, { path: [0, 2, 0, 0], offset: 1 }, "cell");
    expect(resolveScope(coveredDocument, nonRectangular, { want: "table-grid" }, schema)).toMatchObject({
      rect: { top: 1, left: 0, bottom: 2, right: 1 },
      cellIds: ["bottom", "low-left", "low-right"],
      coveredCellIds: ["span"],
      rectangular: false,
    });
  });

  it("describe preserves the unclamped truth for toolbar state", () => {
    const document = tableDocument();
    const value = selection({ path: [0], offset: 1 }, { path: [1, 0, 1, 0], offset: 1 });
    expect(resolveScope(document, value, { want: "block-range" }, schema)).toMatchObject({ clamped: true, isolatingAncestorId: "b" });
    expect(resolveScope(document, value, { want: "describe" }, schema)).toMatchObject({
      blockTypes: ["paragraph"], inTable: { tableId: "table", cellId: "b" }, isolatingAncestorId: "b", spansIsolatingBoundary: true,
    });

    const marked: SmartDocument = { type: "doc", id: "marked-doc", children: [p("marked", "", [
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
    ])] };
    expect(resolveScope(marked, selection({ path: [0], offset: 0 }, { path: [0], offset: 2 }), { want: "describe" }, schema)).toMatchObject({
      marks: [
        { mark: { type: "bold" }, coverage: "all" },
        { mark: { type: "italic" }, coverage: "partial" },
      ],
      spansIsolatingBoundary: false,
    });
  });

  it("rejects renderer UI markers if they leak into the canonical model", () => {
    const leaked: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "ui", attrs: { "data-smart-ui": true }, children: [] }] };
    expect(() => resolveScope(leaked, selection({ path: [0], offset: 0 }), { want: "describe" }, schema)).toThrow("Editor UI nodes");
  });
});
