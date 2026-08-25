import { describe, expect, it } from "vitest";
import type { SmartDocument, SmartElementNode, SmartSelection } from "../types.js";
import { commentRangeFromSelection } from "./fromSelection.js";

const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });

describe("commentRangeFromSelection", () => {
  it("builds an AnnotationRange from a forward text selection within one paragraph", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello world")] };
    const selection: SmartSelection = { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 5 } };
    expect(commentRangeFromSelection(document, selection)).toEqual({ startId: "p1", startOffset: 0, endId: "p1", endOffset: 5 });
  });

  it("normalizes a backward selection (head before anchor) to a forward range", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello world")] };
    const selection: SmartSelection = { type: "text", anchor: { path: [0], offset: 5 }, head: { path: [0], offset: 0 } };
    expect(commentRangeFromSelection(document, selection)).toEqual({ startId: "p1", startOffset: 0, endId: "p1", endOffset: 5 });
  });

  it("spans two different paragraphs", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello"), p("p2", "world")] };
    const selection: SmartSelection = { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [1], offset: 3 } };
    expect(commentRangeFromSelection(document, selection)).toEqual({ startId: "p1", startOffset: 2, endId: "p2", endOffset: 3 });
  });

  it("returns null for a collapsed (empty) selection", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello")] };
    const selection: SmartSelection = { type: "text", anchor: { path: [0], offset: 2 }, head: { path: [0], offset: 2 } };
    expect(commentRangeFromSelection(document, selection)).toBeNull();
  });

  it("returns null for a 'none' selection", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "hello")] };
    const selection: SmartSelection = { type: "none", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } };
    expect(commentRangeFromSelection(document, selection)).toBeNull();
  });

  it("resolves a structural 'node' selection to the containing structural owner's id", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [p("p1", "a"), p("p2", "b")] };
    const selection: SmartSelection = { type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 } };
    expect(commentRangeFromSelection(document, selection)).toEqual({ startId: "doc", startOffset: 0, endId: "doc", endOffset: 1 });
  });
});
