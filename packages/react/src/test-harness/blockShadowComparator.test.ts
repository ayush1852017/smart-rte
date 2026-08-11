// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTransaction, toggleBlockquote, type LegacySmartDocument, type SmartEditorState } from "smartrte-core/legacy";
import { runBlockShadowCorpus } from "./blockShadowComparator.js";

describe("Phase 5 retained legacy block shadow corpus", () => {
  it("has no unexplained semantic/data-loss divergence in 3,000 cases (seed 0xB10C2026)", () => {
    const summary = runBlockShadowCorpus(3_000);
    expect(summary.divergences.semantic).toBeUndefined();
    expect(summary.divergences["data-loss"]).toBeUndefined();
    expect(JSON.stringify(summary.logs)).not.toContain("plain");
    expect(JSON.stringify(summary.logs)).not.toContain("marked");
  });

  it("retained blockquote toggle wraps a list once rather than each item", () => {
    const document: LegacySmartDocument = {
      type: "doc",
      children: [{ type: "list", style: "disc", children: [
        { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", text: "A" }] }] },
        { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", text: "B" }] }] },
      ] }],
    };
    const state: SmartEditorState = {
      document,
      selection: { type: "text", anchor: { path: [0, 0, 0, 0], offset: 0 }, focus: { path: [0, 1, 0, 0], offset: 1 } },
    };
    const next = applyTransaction(state, toggleBlockquote.execute(state, { parentPath: [], blockIndexes: [0] }));
    expect(next.document.children).toHaveLength(1);
    expect(next.document.children[0]).toMatchObject({ type: "blockquote", children: [{ type: "list" }] });
  });
});
