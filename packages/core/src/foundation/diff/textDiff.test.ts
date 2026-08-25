import { describe, expect, it } from "vitest";
import type { SmartMark } from "../types.js";
import { diffTextRuns, type TextRun } from "./textDiff.js";

const run = (text: string, marks: readonly SmartMark[] = []): TextRun => ({ text, marks });
const bold: SmartMark[] = [{ type: "bold" }];

describe("diffTextRuns", () => {
  it("reports identical content as a single equal segment", () => {
    expect(diffTextRuns([run("hello world")], [run("hello world")])).toEqual([
      { op: "equal", text: "hello world", marks: [] },
    ]);
  });

  it("reports a pure word insertion", () => {
    expect(diffTextRuns([run("hello world")], [run("hello brave world")])).toEqual([
      { op: "equal", text: "hello ", marks: [] },
      { op: "insert", text: "brave ", marks: [] },
      { op: "equal", text: "world", marks: [] },
    ]);
  });

  it("reports a pure word deletion", () => {
    expect(diffTextRuns([run("hello brave world")], [run("hello world")])).toEqual([
      { op: "equal", text: "hello ", marks: [] },
      { op: "delete", text: "brave ", marks: [] },
      { op: "equal", text: "world", marks: [] },
    ]);
  });

  it("reports a mark-only change on identical text as markChange, not delete+insert", () => {
    expect(diffTextRuns([run("hello world")], [run("hello ", []), run("world", bold)])).toEqual([
      { op: "equal", text: "hello ", marks: [] },
      { op: "markChange", text: "world", before: [], after: bold },
    ]);
  });

  it("handles a full replacement (no shared words) as one delete and one insert, not fragmented by a spuriously-matching shared space", () => {
    // A naive whitespace-as-its-own-token tokenizer would match the lone
    // space between "alpha"/"beta" and "gamma"/"delta", fragmenting this
    // into delete/insert/equal(" ")/delete/insert instead.
    expect(diffTextRuns([run("alpha beta")], [run("gamma delta")])).toEqual([
      { op: "delete", text: "alpha beta", marks: [] },
      { op: "insert", text: "gamma delta", marks: [] },
    ]);
  });

  it("handles empty-to-content and content-to-empty", () => {
    expect(diffTextRuns([], [run("new text")])).toEqual([{ op: "insert", text: "new text", marks: [] }]);
    expect(diffTextRuns([run("old text")], [])).toEqual([{ op: "delete", text: "old text", marks: [] }]);
    expect(diffTextRuns([], [])).toEqual([]);
  });

  it("never lets a token straddle a run boundary, even when adjacent runs have different marks", () => {
    const before = [run("foo", []), run("bar", bold)];
    const after = [run("foo", []), run("bar", bold)];
    expect(diffTextRuns(before, after)).toEqual([
      { op: "equal", text: "foo", marks: [] },
      { op: "equal", text: "bar", marks: bold },
    ]);
  });

  it("treats mark order as insignificant when comparing for markChange", () => {
    const beforeMarks: SmartMark[] = [{ type: "bold" }, { type: "italic" }];
    const afterMarks: SmartMark[] = [{ type: "italic" }, { type: "bold" }];
    expect(diffTextRuns([run("word", beforeMarks)], [run("word", afterMarks)])).toEqual([
      { op: "equal", text: "word", marks: afterMarks },
    ]);
  });
});
