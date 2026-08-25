import { describe, expect, it } from "vitest";
import {
  acceptSuggestionCommand,
  applyOperations,
  createScopeIndex,
  findSuggestionRuns,
  foundationSchema,
  listInlineSuggestions,
  rejectSuggestionCommand,
  suggestDeleteCommand,
  suggestInsertOperation,
  type InlineRangeScope,
  type MarkCommandContext,
  type SmartDocument,
  type SmartSelection,
} from "../index.js";

const selection = (from: number, to = from, path = [0]): SmartSelection => ({
  type: "text", anchor: { path: [...path], offset: from }, head: { path: [...path], offset: to },
});
const contextFor = (document: SmartDocument): MarkCommandContext => ({
  schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema),
});
const inlineScope = (document: SmartDocument, from: number, to: number, path = [0]) =>
  createScopeIndex().resolve(document, selection(from, to, path), { want: "inline-range" }, foundationSchema) as InlineRangeScope;

describe("Phase 12a §2.3 - inline suggestions (mark-based)", () => {
  describe("suggestInsertOperation", () => {
    it("builds an insertText operation carrying a fresh insert-kind suggestion mark", () => {
      const operation = suggestInsertOperation({ path: [0], offset: 0 }, "hi", { authorId: "alice" });
      expect(operation.type).toBe("insertText");
      expect(operation).toMatchObject({ text: "hi" });
      const marks = (operation as { marks?: readonly { type: string; attrs?: Record<string, unknown> }[] }).marks || [];
      expect(marks).toHaveLength(1);
      expect(marks[0]).toMatchObject({ type: "suggestion", attrs: { authorId: "alice", kind: "insert" } });
      expect(typeof marks[0].attrs?.id).toBe("string");
      expect(typeof marks[0].attrs?.createdAt).toBe("number");
    });

    it("carries through other active marks unchanged (e.g. bold applied while suggesting)", () => {
      const operation = suggestInsertOperation({ path: [0], offset: 0 }, "hi", { authorId: "alice" }, [{ type: "bold" }]);
      const marks = (operation as { marks?: readonly { type: string }[] }).marks || [];
      expect(marks.map((mark) => mark.type)).toEqual(["bold", "suggestion"]);
    });
  });

  describe("suggestDeleteCommand", () => {
    it("marks a range for deletion without deleting it", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "hello world" }] }] };
      const operations = suggestDeleteCommand(document, inlineScope(document, 0, 5), { authorId: "alice" }, contextFor(document));
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ type: "addMark", mark: { type: "suggestion", attrs: { authorId: "alice", kind: "delete" } } });
      const after = applyOperations(document, operations);
      expect(after.children[0].children).toEqual([
        { type: "text", text: "hello", marks: [{ type: "suggestion", attrs: expect.objectContaining({ authorId: "alice", kind: "delete" }) }] },
        { type: "text", text: " world" },
      ]);
    });

    it("shares one suggestion id across a selection spanning multiple paragraphs", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p0", children: [{ type: "text", text: "a" }] },
        { type: "paragraph", id: "p1", children: [{ type: "text", text: "b" }] },
      ] };
      const scope = createScopeIndex().resolve(document, {
        type: "text", anchor: { path: [0], offset: 0 }, head: { path: [1], offset: 1 },
      }, { want: "inline-range" }, foundationSchema) as InlineRangeScope;
      const operations = suggestDeleteCommand(document, scope, { authorId: "alice", id: "s1" }, contextFor(document));
      expect(operations.filter((operation) => operation.type === "addMark")).toHaveLength(2);
      const after = applyOperations(document, operations);
      const runs = findSuggestionRuns(after, "s1");
      expect(runs.map((run) => run.ownerNodeId)).toEqual(["p0", "p1"]);
      expect(runs.map((run) => run.text)).toEqual(["a", "b"]);
    });
  });

  describe("findSuggestionRuns", () => {
    it("finds a single contiguous run within one owner", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "hello", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] },
        { type: "text", text: " world" },
      ] }] };
      const runs = findSuggestionRuns(document, "s1");
      expect(runs).toEqual([{ ownerNodeId: "p", range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: 5 } }, mark: { type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }, text: "hello" }]);
    });

    it("finds nothing for an unknown id", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] }] };
      expect(findSuggestionRuns(document, "missing")).toEqual([]);
    });
  });

  describe("listInlineSuggestions", () => {
    it("returns one summary per distinct id, concatenating text across runs", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p0", children: [{ type: "text", text: "a", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "alice", kind: "delete", createdAt: 5 } }] }] },
        { type: "paragraph", id: "p1", children: [{ type: "text", text: "b", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "alice", kind: "delete", createdAt: 5 } }] }] },
        { type: "paragraph", id: "p2", children: [{ type: "text", text: "hi", marks: [{ type: "suggestion", attrs: { id: "s2", authorId: "bob", kind: "insert", createdAt: 9 } }] }] },
      ] };
      const summaries = listInlineSuggestions(document);
      expect(summaries).toHaveLength(2);
      expect(summaries.find((entry) => entry.id === "s1")).toEqual({ id: "s1", authorId: "alice", kind: "delete", createdAt: 5, text: "ab" });
      expect(summaries.find((entry) => entry.id === "s2")).toEqual({ id: "s2", authorId: "bob", kind: "insert", createdAt: 9, text: "hi" });
    });

    it("returns an empty list for a document with no suggestion marks", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "plain" }] }] };
      expect(listInlineSuggestions(document)).toEqual([]);
    });
  });

  describe("acceptSuggestionCommand / rejectSuggestionCommand", () => {
    it("accepting an insert-kind suggestion keeps the text and strips the mark", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "hi", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "insert", createdAt: 1 } }] },
      ] }] };
      const after = applyOperations(document, acceptSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([{ type: "text", text: "hi" }]);
    });

    it("rejecting an insert-kind suggestion deletes the text", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "before" },
        { type: "text", text: "hi", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "insert", createdAt: 1 } }] },
      ] }] };
      const after = applyOperations(document, rejectSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([{ type: "text", text: "before" }]);
    });

    it("accepting a delete-kind suggestion actually removes the text", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "keep" },
        { type: "text", text: "gone", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] },
      ] }] };
      const after = applyOperations(document, acceptSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([{ type: "text", text: "keep" }]);
    });

    it("rejecting a delete-kind suggestion keeps the text and strips the mark", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "stay", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] },
      ] }] };
      const after = applyOperations(document, rejectSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([{ type: "text", text: "stay" }]);
    });

    it("resolves a suggestion split across two paragraphs by a structural edit", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [
        { type: "paragraph", id: "p0", children: [{ type: "text", text: "a", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] }] },
        { type: "paragraph", id: "p1", children: [{ type: "text", text: "b", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] }] },
      ] };
      const after = applyOperations(document, acceptSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([]);
      expect(after.children[1].children).toEqual([]);
    });

    it("handles two discontiguous same-id runs in one owner without offset drift (back-to-front application)", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [
        { type: "text", text: "gone1", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] },
        { type: "text", text: "-keep-" },
        { type: "text", text: "gone2", marks: [{ type: "suggestion", attrs: { id: "s1", authorId: "a", kind: "delete", createdAt: 1 } }] },
      ] }] };
      const after = applyOperations(document, acceptSuggestionCommand(document, "s1"));
      expect(after.children[0].children).toEqual([{ type: "text", text: "-keep-" }]);
    });

    it("does nothing for an unknown suggestion id", () => {
      const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "hello" }] }] };
      expect(acceptSuggestionCommand(document, "missing")).toEqual([]);
      expect(rejectSuggestionCommand(document, "missing")).toEqual([]);
    });
  });
});
