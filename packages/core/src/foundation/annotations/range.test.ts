import { describe, expect, it } from "vitest";
import { applyOperation, invertOperation } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartElementNode, SmartOperation } from "../types.js";
import { defaultMergeOrphanPolicy, rebaseAnnotationRange, rebaseAnnotationRangeThroughOperations, resolveAnnotationRange } from "./range.js";
import type { AnnotationRange, MergeNodeOperation } from "./types.js";

const letters = (id: string, count: number, start = 0): SmartElementNode => ({
  type: "paragraph", id, children: Array.from({ length: count }, (_, index) => ({ type: "text" as const, text: String.fromCharCode(97 + start + index) })),
});
const doc = (paragraph: SmartElementNode): SmartDocument => ({ type: "doc", id: "doc", children: [paragraph] });
const positionsOf = (document: SmartDocument) => createScopeIndex().positions(document, foundationSchema);
const dropPolicy = () => null;

describe("resolveAnnotationRange", () => {
  it("resolves a text-anchored range against the current document", () => {
    const model = doc(letters("p", 4));
    const range: AnnotationRange = { startId: "p", startOffset: 1, endId: "p", endOffset: 3 };
    expect(resolveAnnotationRange(range, positionsOf(model))).toEqual({
      from: { path: [0], offset: 1 },
      to: { path: [0], offset: 3 },
    });
  });

  it("resolves a whole-node anchor via the node's outer span when offsets are absent", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("p1", 2), letters("p2", 2)] };
    const range: AnnotationRange = { startId: "p1", endId: "p1" };
    const resolved = resolveAnnotationRange(range, positionsOf(model));
    // Outer span of a top-level block: the doc's own [path:[], offset] slot it occupies.
    expect(resolved).toEqual({ from: { path: [], offset: 0 }, to: { path: [], offset: 1 } });
  });

  it("returns null once an anchor id no longer exists", () => {
    const model = doc(letters("p", 4));
    const range: AnnotationRange = { startId: "gone", startOffset: 0, endId: "gone", endOffset: 1 };
    expect(resolveAnnotationRange(range, positionsOf(model))).toBeNull();
  });
});

describe("rebaseAnnotationRange - splitNode", () => {
  it("keeps the pre-split id and offset when the endpoint stays left of the split point", () => {
    const model = doc(letters("p", 6));
    const positions = positionsOf(model);
    const operation: SmartOperation = { type: "splitNode", pos: { path: [0], offset: 3 }, depth: 0, newId: "p-right" };
    const range: AnnotationRange = { startId: "p", startOffset: 1, endId: "p", endOffset: 1 };
    const rebased = rebaseAnnotationRange(range, operation, positions, dropPolicy);
    expect(rebased).toEqual({ startId: "p", startOffset: 1, endId: "p", endOffset: 1 });
    const after = applyOperation(model, operation);
    expect(resolveAnnotationRange(rebased!, positionsOf(after))).toEqual({ from: { path: [0], offset: 1 }, to: { path: [0], offset: 1 } });
  });

  it("rewrites to the new id and rebases the offset when the endpoint moved past the split point", () => {
    const model = doc(letters("p", 6));
    const positions = positionsOf(model);
    const operation: SmartOperation = { type: "splitNode", pos: { path: [0], offset: 3 }, depth: 0, newId: "p-right" };
    const range: AnnotationRange = { startId: "p", startOffset: 4, endId: "p", endOffset: 5 };
    const rebased = rebaseAnnotationRange(range, operation, positions, dropPolicy);
    expect(rebased).toEqual({ startId: "p-right", startOffset: 1, endId: "p-right", endOffset: 2 });
    const after = applyOperation(model, operation);
    // Position 4 in the original 6-letter paragraph was "e"; after splitting
    // at 3, the right half is ["d","e","f"] and rebased offset 1 must still
    // point at "e" - this is the actual correctness claim, not just shape.
    const rightParagraph = after.children[1] as SmartElementNode;
    expect((rightParagraph.children![1] as { text: string }).text).toBe("e");
    expect(resolveAnnotationRange(rebased!, positionsOf(after))).toEqual({ from: { path: [1], offset: 1 }, to: { path: [1], offset: 2 } });
  });

  it("leaves an anchor to an unrelated node untouched by a split it has nothing to do with", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("p1", 4), letters("p2", 4)] };
    const positions = positionsOf(model);
    const operation: SmartOperation = { type: "splitNode", pos: { path: [0], offset: 2 }, depth: 0, newId: "p1-right" };
    const range: AnnotationRange = { startId: "p2", startOffset: 0, endId: "p2", endOffset: 2 };
    expect(rebaseAnnotationRange(range, operation, positions, dropPolicy)).toEqual(range);
  });
});

describe("rebaseAnnotationRange - mergeNode", () => {
  const mergedModel: SmartDocument = { type: "doc", id: "doc", children: [letters("left", 3), letters("right", 3, 3)] };
  const mergeOperation: MergeNodeOperation = { type: "mergeNode", pos: { path: [], offset: 1 }, depth: 0, retiredId: "right", splitOffset: 3 };

  it("passes a range through unchanged when neither endpoint anchors the retired id", () => {
    const range: AnnotationRange = { startId: "left", startOffset: 0, endId: "left", endOffset: 2 };
    expect(rebaseAnnotationRange(range, mergeOperation, positionsOf(mergedModel), dropPolicy)).toEqual(range);
  });

  it("invokes the orphan policy when an endpoint anchors the retired id, and honors a drop policy", () => {
    const range: AnnotationRange = { startId: "right", startOffset: 0, endId: "right", endOffset: 2 };
    expect(rebaseAnnotationRange(range, mergeOperation, positionsOf(mergedModel), dropPolicy)).toBeNull();
  });

  it("honors a caller policy that snaps an orphaned endpoint into the surviving node", () => {
    const range: AnnotationRange = { startId: "right", startOffset: 1, endId: "right", endOffset: 2 };
    const snapIntoLeft = (candidate: AnnotationRange, operation: MergeNodeOperation) => ({
      startId: candidate.startId === operation.retiredId ? "left" : candidate.startId,
      startOffset: candidate.startId === operation.retiredId ? operation.splitOffset + (candidate.startOffset ?? 0) : candidate.startOffset,
      endId: candidate.endId === operation.retiredId ? "left" : candidate.endId,
      endOffset: candidate.endId === operation.retiredId ? operation.splitOffset + (candidate.endOffset ?? 0) : candidate.endOffset,
    });
    const rebased = rebaseAnnotationRange(range, mergeOperation, positionsOf(mergedModel), snapIntoLeft);
    expect(rebased).toEqual({ startId: "left", startOffset: 4, endId: "left", endOffset: 5 });
    const after = applyOperation(mergedModel, mergeOperation);
    const merged = after.children[0] as SmartElementNode;
    expect((merged.children![4] as { text: string }).text).toBe("e"); // "right"'s index 1 ("e") is now at merged index 3+1
    expect(resolveAnnotationRange(rebased!, positionsOf(after))).toEqual({ from: { path: [0], offset: 4 }, to: { path: [0], offset: 5 } });
  });
});

describe("rebaseAnnotationRange - removeNode.mergedInto (Phase 12a §2.1a)", () => {
  const model: SmartDocument = { type: "doc", id: "doc", children: [letters("survivor", 3), letters("absorbed", 3, 3)] };

  it("snaps a whole-node anchor on the absorbed node to the survivor", () => {
    const operation: SmartOperation = { type: "removeNode", pos: { path: [], offset: 1 }, node: letters("absorbed", 3, 3), mergedInto: "survivor" };
    const range: AnnotationRange = { startId: "absorbed", endId: "absorbed" };
    expect(rebaseAnnotationRange(range, operation, positionsOf(model), dropPolicy)).toEqual({ startId: "survivor", startOffset: undefined, endId: "survivor", endOffset: undefined });
  });

  it("does not invoke the caller policy at all - the field's presence is unconditional, no ambiguity to resolve", () => {
    const operation: SmartOperation = { type: "removeNode", pos: { path: [], offset: 1 }, node: letters("absorbed", 3, 3), mergedInto: "survivor" };
    const range: AnnotationRange = { startId: "absorbed", endId: "absorbed" };
    const failIfCalled = () => { throw new Error("onOrphan must not be called for a mergedInto-marked removeNode"); };
    expect(() => rebaseAnnotationRange(range, operation, positionsOf(model), failIfCalled)).not.toThrow();
  });

  it("leaves a plain removeNode with no mergedInto field as an unconditional orphan (no rebase, resolves null once removed)", () => {
    const operation: SmartOperation = { type: "removeNode", pos: { path: [], offset: 1 }, node: letters("absorbed", 3, 3) };
    const range: AnnotationRange = { startId: "absorbed", endId: "absorbed" };
    expect(rebaseAnnotationRange(range, operation, positionsOf(model), dropPolicy)).toEqual(range);
    const after = applyOperation(model, operation);
    expect(resolveAnnotationRange(range, positionsOf(after))).toBeNull();
  });

  it("leaves an anchor to an unrelated node untouched", () => {
    const operation: SmartOperation = { type: "removeNode", pos: { path: [], offset: 1 }, node: letters("absorbed", 3, 3), mergedInto: "survivor" };
    const range: AnnotationRange = { startId: "survivor", startOffset: 0, endId: "survivor", endOffset: 2 };
    expect(rebaseAnnotationRange(range, operation, positionsOf(model), dropPolicy)).toEqual(range);
  });
});

describe("rebaseAnnotationRange - replaceNode.retiredInto (Phase 12a §2.1a)", () => {
  it("snaps each retired id independently to its own survivor, in one replaceNode - clearing any offset, since a merge concatenates content in an order this generic mechanism has no way to know, so a stale offset into the retired node's own text can't be reliably remapped into the merged text", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("target", 2)] };
    const operation: SmartOperation = {
      type: "replaceNode", pos: { path: [], offset: 0 }, before: letters("source", 2), after: letters("target", 2),
      retiredInto: [{ retiredId: "source-item", survivorId: "target-item" }, { retiredId: "source-p", survivorId: "target-p" }],
    };
    const itemRange: AnnotationRange = { startId: "source-item", endId: "source-item" };
    const paragraphRange: AnnotationRange = { startId: "source-p", startOffset: 0, endId: "source-p", endOffset: 1 };
    expect(rebaseAnnotationRange(itemRange, operation, positionsOf(model), dropPolicy)).toEqual({ startId: "target-item", startOffset: undefined, endId: "target-item", endOffset: undefined });
    expect(rebaseAnnotationRange(paragraphRange, operation, positionsOf(model), dropPolicy)).toEqual({ startId: "target-p", startOffset: undefined, endId: "target-p", endOffset: undefined });
  });

  it("leaves a plain replaceNode with no retiredInto field untouched (ordinary content replacement, not a merge)", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("p", 2)] };
    const operation: SmartOperation = { type: "replaceNode", pos: { path: [], offset: 0 }, before: letters("p", 2), after: letters("p", 3) };
    const range: AnnotationRange = { startId: "p", startOffset: 0, endId: "p", endOffset: 1 };
    expect(rebaseAnnotationRange(range, operation, positionsOf(model), dropPolicy)).toEqual(range);
  });
});

describe("defaultMergeOrphanPolicy (Phase 12a §2.1b - snap to survivor, not drop)", () => {
  it("derives the survivor as the sibling immediately preceding the merge point and snaps the orphaned endpoint into it", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("left", 3), letters("right", 3, 3)] };
    const mergeOperation: MergeNodeOperation = { type: "mergeNode", pos: { path: [], offset: 1 }, depth: 0, retiredId: "right", splitOffset: 3 };
    const range: AnnotationRange = { startId: "right", startOffset: 1, endId: "right", endOffset: 2 };
    const rebased = rebaseAnnotationRange(range, mergeOperation, positionsOf(model), defaultMergeOrphanPolicy(model));
    expect(rebased).toEqual({ startId: "left", startOffset: undefined, endId: "left", endOffset: undefined });
    // Resolves to the survivor's whole-node span, a genuinely valid (if
    // coarser than the original text offsets) anchor - not null/lost.
    expect(resolveAnnotationRange(rebased!, positionsOf(applyOperation(model, mergeOperation)))).not.toBeNull();
  });

  it("returns null (orphans) if the merge point has no preceding sibling to snap to", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("only", 3)] };
    const mergeOperation: MergeNodeOperation = { type: "mergeNode", pos: { path: [], offset: 0 }, depth: 0, retiredId: "only", splitOffset: 0 };
    const range: AnnotationRange = { startId: "only", endId: "only" };
    expect(rebaseAnnotationRange(range, mergeOperation, positionsOf(model), defaultMergeOrphanPolicy(model))).toBeNull();
  });
});

describe("rebaseAnnotationRangeThroughOperations", () => {
  it("folds through a mixed sequence, short-circuiting once dropped", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("left", 3), letters("right", 3)] };
    const mergeOperation: MergeNodeOperation = { type: "mergeNode", pos: { path: [], offset: 1 }, depth: 0, retiredId: "right", splitOffset: 3 };
    const range: AnnotationRange = { startId: "right", startOffset: 0, endId: "right", endOffset: 1 };
    const result = rebaseAnnotationRangeThroughOperations(
      range,
      [{ operation: mergeOperation, positions: positionsOf(model) }],
      dropPolicy,
    );
    expect(result).toBeNull();
  });

  it("carries a live range unchanged through operations that do not touch its anchors", () => {
    const model: SmartDocument = { type: "doc", id: "doc", children: [letters("p1", 4), letters("p2", 4)] };
    const splitOfOther: SmartOperation = { type: "splitNode", pos: { path: [0], offset: 2 }, depth: 0, newId: "p1-right" };
    const range: AnnotationRange = { startId: "p2", startOffset: 0, endId: "p2", endOffset: 2 };
    const result = rebaseAnnotationRangeThroughOperations(
      range,
      [{ operation: splitOfOther, positions: positionsOf(model) }],
      dropPolicy,
    );
    expect(result).toEqual(range);
  });
});

describe("property: split then its own undo restores exact identity (seed 0xA27A0)", () => {
  it("round-trips split -> rebase -> merge-undo -> rebase back to the original range in 500 cases", () => {
    let seed = 0xA27A0;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let run = 0; run < 500; run += 1) {
      const size = 2 + random(8); // 2..9 letters
      const model = doc(letters("p", size));
      const positionsBefore = positionsOf(model);
      const splitPoint = random(size + 1); // 0..size
      const original: AnnotationRange = { startId: "p", startOffset: random(size + 1), endId: "p", endOffset: random(size + 1) };
      const splitOp: SmartOperation = { type: "splitNode", pos: { path: [0], offset: splitPoint }, depth: 0, newId: `p-right-${run}` };

      const afterSplitDoc = applyOperation(model, splitOp);
      const rebasedAfterSplit = rebaseAnnotationRange(original, splitOp, positionsBefore, dropPolicy);
      expect(rebasedAfterSplit).not.toBeNull();
      // Cross-check against direct resolution: rebasing then resolving must
      // agree with what is actually at that position post-split.
      expect(resolveAnnotationRange(rebasedAfterSplit!, positionsOf(afterSplitDoc))).not.toBeNull();

      const mergeOp = invertOperation(splitOp) as MergeNodeOperation;
      const positionsAfterSplit = positionsOf(afterSplitDoc);
      // The endpoint that moved right is now anchored to the retired id the
      // undo-merge will consume - snap it back using the merge's own
      // splitOffset, mirroring how a consumer would reconstruct the
      // pre-split anchor deterministically.
      const snapBack = (candidate: AnnotationRange, operation: MergeNodeOperation) => ({
        startId: candidate.startId === operation.retiredId ? "p" : candidate.startId,
        startOffset: candidate.startId === operation.retiredId ? operation.splitOffset + (candidate.startOffset ?? 0) : candidate.startOffset,
        endId: candidate.endId === operation.retiredId ? "p" : candidate.endId,
        endOffset: candidate.endId === operation.retiredId ? operation.splitOffset + (candidate.endOffset ?? 0) : candidate.endOffset,
      });
      const rebasedAfterUndo = rebaseAnnotationRange(rebasedAfterSplit!, mergeOp, positionsAfterSplit, snapBack);
      expect(rebasedAfterUndo).toEqual(original);

      const restoredDoc = applyOperation(afterSplitDoc, mergeOp);
      expect(restoredDoc).toEqual(model);
      expect(resolveAnnotationRange(rebasedAfterUndo!, positionsOf(restoredDoc))).toEqual(resolveAnnotationRange(original, positionsBefore));
    }
  });
});
