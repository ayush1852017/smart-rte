import { describe, expect, it } from "vitest";
import { paragraph, resolveListSelectionScope, type SmartDocument } from "./index.js";

const selection = (anchor: number[], focus: number[]) => ({
  type: "text" as const,
  anchor: { path: anchor, offset: 0 },
  focus: { path: focus, offset: 1 },
});

const document: SmartDocument = {
  type: "doc",
  children: [
    paragraph("Heading"),
    {
      type: "list",
      style: "disc",
      children: [{
        type: "listItem",
        children: [paragraph("Parent"), {
          type: "list",
          style: "circle",
          children: [
            { type: "listItem", children: [paragraph("Child one")] },
            { type: "listItem", children: [paragraph("Child two")] },
          ],
        }],
      }, { type: "listItem", children: [paragraph("Sibling")] }],
    },
  ],
};

describe("list selection scope", () => {
  it("resolves a nested-only selection to the nested list", () => {
    expect(resolveListSelectionScope(document, selection([1, 0, 1, 0, 0, 0], [1, 0, 1, 1, 0, 0]))).toEqual({
      kind: "list", listPath: [1, 0, 1], start: 0, end: 1,
    });
  });

  it("resolves a heading-to-parent selection as mixed", () => {
    expect(resolveListSelectionScope(document, selection([0, 0], [1, 0, 1, 1, 0, 0]))).toEqual({
      kind: "mixed", containerPath: [], blockIndex: 0, listPath: [1], itemStart: 0, itemEnd: 0,
    });
  });

  it("resolves an outer list item run to the containing list", () => {
    expect(resolveListSelectionScope(document, selection([1, 0, 0, 0], [1, 1, 0, 0]))).toEqual({
      kind: "list", listPath: [1], start: 0, end: 1,
    });
  });
});
