import { describe, expect, it } from "vitest";
import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartElementNode } from "../types.js";
import { diffDocuments } from "./documentDiff.js";

const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

const paragraph = (id: string, random: () => number): SmartElementNode => {
  const count = 1 + Math.floor(random() * 4);
  const text = Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(" ");
  return { type: "paragraph", id, children: [{ type: "text", text }] };
};

const randomDoc = (run: number, random: () => number): SmartDocument => {
  const count = 2 + Math.floor(random() * 5);
  return { type: "doc", id: `doc-${run}`, children: Array.from({ length: count }, (_, index) => paragraph(`p-${run}-${index}`, random)) };
};

describe("Phase 12a document diff property", () => {
  it("diffing a document against itself (and a structural clone of itself) is always empty, in 500 randomly-generated cases (seed 0xD1FF5EED)", () => {
    let state = 0xD1FF5EED;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let run = 0; run < 500; run += 1) {
      const model = randomDoc(run, random);
      expect(diffDocuments(model, model, foundationSchema)).toEqual({ added: [], removed: [], changed: [] });
      expect(diffDocuments(model, structuredClone(model), foundationSchema)).toEqual({ added: [], removed: [], changed: [] });
    }
  });

  it("a single random mutation produces a diff whose footprint is exactly that one node - never more, never less - in 500 cases (seed 0x0D1FF000)", () => {
    let state = 0x0D1FF000;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let run = 0; run < 500; run += 1) {
      const before = randomDoc(run, random);
      const targetIndex = Math.floor(random() * before.children.length);
      const targetId = (before.children[targetIndex] as SmartElementNode).id;
      const mutation = Math.floor(random() * 5);
      let after: SmartDocument;
      let expectFootprint: (diff: ReturnType<typeof diffDocuments>) => void;

      if (mutation === 0) {
        // Content mutation: append a word to the target paragraph's text.
        after = { ...before, children: before.children.map((child, index) => index === targetIndex
          ? { ...(child as SmartElementNode), children: [{ type: "text", text: `${((child as SmartElementNode).children![0] as { text: string }).text} zulu` }] }
          : child) };
        expectFootprint = (diff) => {
          expect(diff.added).toEqual([]);
          expect(diff.removed).toEqual([]);
          expect(diff.changed.map((entry) => entry.nodeId)).toEqual([targetId]);
          expect(diff.changed[0].contentChange).toBeDefined();
          expect(diff.changed[0].move).toBeUndefined();
          expect(diff.changed[0].typeChange).toBeUndefined();
        };
      } else if (mutation === 1) {
        // Type + attrs mutation: promote the target paragraph to a heading.
        after = { ...before, children: before.children.map((child, index) => index === targetIndex
          ? { ...(child as SmartElementNode), type: "heading", attrs: { level: 2 } }
          : child) };
        expectFootprint = (diff) => {
          expect(diff.added).toEqual([]);
          expect(diff.removed).toEqual([]);
          expect(diff.changed.map((entry) => entry.nodeId)).toEqual([targetId]);
          expect(diff.changed[0].typeChange).toEqual({ before: "paragraph", after: "heading" });
          expect(diff.changed[0].contentChange).toBeUndefined();
          expect(diff.changed[0].move).toBeUndefined();
        };
      } else if (mutation === 2) {
        // Removal: the target paragraph is gone, nothing else touched.
        after = { ...before, children: before.children.filter((_, index) => index !== targetIndex) };
        expectFootprint = (diff) => {
          expect(diff.added).toEqual([]);
          expect(diff.changed).toEqual([]);
          expect(diff.removed.map((entry) => entry.nodeId)).toEqual([targetId]);
        };
      } else if (mutation === 3) {
        // Insertion: one new paragraph added at a random position; every
        // retained node keeps its relative order, so nothing else changes.
        const newId = `new-${run}`;
        const insertAt = Math.floor(random() * (before.children.length + 1));
        const next = [...before.children];
        next.splice(insertAt, 0, paragraph(newId, random));
        after = { ...before, children: next };
        expectFootprint = (diff) => {
          expect(diff.removed).toEqual([]);
          expect(diff.changed).toEqual([]);
          expect(diff.added.map((entry) => entry.nodeId)).toEqual([newId]);
        };
      } else {
        // Move: the target paragraph relocates to the very end of its
        // parent's children. Removing one element and appending it at the
        // end can never perturb any other element's relative order, so
        // every other retained id must show zero footprint.
        const alreadyLast = targetIndex === before.children.length - 1;
        const withoutTarget = before.children.filter((_, index) => index !== targetIndex);
        after = { ...before, children: [...withoutTarget, before.children[targetIndex]] };
        expectFootprint = (diff) => {
          expect(diff.added).toEqual([]);
          expect(diff.removed).toEqual([]);
          // A target already at the last position moves to... the last
          // position - a genuine no-op, not a move. Everywhere else, it's
          // exactly one move entry and nothing else.
          if (alreadyLast) {
            expect(diff.changed).toEqual([]);
          } else {
            expect(diff.changed.map((entry) => entry.nodeId)).toEqual([targetId]);
            expect(diff.changed[0].move).toBeDefined();
          }
        };
      }

      expectFootprint(diffDocuments(before, after, foundationSchema));
    }
  });
});
