import { describe, expect, it } from "vitest";
import { compareShadowDocuments, foundationSchema, shadowLogRecord, type SmartDocument } from "../index.js";

const document = (ids: [string, string, string], text = "customer secret"): SmartDocument => ({
  type: "doc", id: ids[0], children: [{ type: "list", id: ids[1], attrs: { style: "disc" }, children: [{
    type: "list_item", id: ids[2], children: [{ type: "paragraph", id: `${ids[2]}-p`, children: [{ type: "text", text }] }],
  }] }],
});
const selection = { type: "text" as const, anchor: { path: [0, 0, 0], offset: 3 }, head: { path: [0, 0, 0], offset: 3 } };

describe("Phase 3 shadow comparator policy", () => {
  it("ignores IDs and operation history while comparing normalized structure and semantic selection", () => {
    const result = compareShadowDocuments({
      legacyDocument: document(["legacy-doc", "legacy-list", "legacy-item"]),
      legacySelection: selection,
      canonicalDocument: document(["canonical-doc", "canonical-list", "canonical-item"]),
      canonicalSelection: selection,
      schema: foundationSchema,
    });
    expect(result).toMatchObject({ equivalent: true, documentEquivalent: true, selectionEquivalent: true });
    expect(result).not.toHaveProperty("classification");
  });

  it("classifies selection-only and semantic divergence without logging text", () => {
    const selectionOnly = compareShadowDocuments({
      legacyDocument: document(["a", "b", "c"]), legacySelection: selection,
      canonicalDocument: document(["x", "y", "z"]),
      canonicalSelection: { ...selection, anchor: { ...selection.anchor, offset: 2 }, head: { ...selection.head, offset: 2 } },
      schema: foundationSchema,
    });
    expect(selectionOnly.classification).toBe("selection-only");
    const semantic = compareShadowDocuments({
      legacyDocument: document(["a", "b", "c"]), legacySelection: selection,
      canonicalDocument: document(["x", "y", "z"], "lost"), canonicalSelection: selection,
      schema: foundationSchema, classification: "data-loss",
    });
    const log = shadowLogRecord("scenario-1", semantic);
    expect(log).toMatchObject({ classification: "data-loss", equivalent: false });
    expect(JSON.stringify(log)).not.toContain("customer secret");
    expect(JSON.stringify(log)).not.toContain("lost");
    expect(Object.keys(log).some((key) => /(?:legacy|canonical)(?:Document|Html|Text)$/i.test(key))).toBe(false);
  });
});
