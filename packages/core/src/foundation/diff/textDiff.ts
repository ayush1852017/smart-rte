import type { SmartMark } from "../types.js";
import { canonicalMarkOrder, markKey } from "../marks/canonical.js";
import type { TextDiffSegment } from "./types.js";

export interface TextRun {
  readonly text: string;
  readonly marks: readonly SmartMark[];
}

interface Token {
  readonly text: string;
  readonly marks: readonly SmartMark[];
}

/**
 * Word-boundary tokenizer: each token is a run of non-whitespace plus its
 * own trailing whitespace (leading whitespace with no preceding word, e.g.
 * at the very start of a run, becomes its own token). Deliberately not
 * further split on punctuation - this project's diff is word-granularity,
 * not a linguistic tokenizer. Gluing whitespace onto its word rather than
 * treating every space as an independent token matters for LCS matching
 * below: an isolated whitespace token can spuriously "match" between two
 * otherwise-unrelated words (e.g. "alpha beta" -> "gamma delta" sharing
 * nothing but a space), fragmenting what should read as one clean
 * delete+insert into delete/insert/equal(" ")/delete/insert.
 */
const tokenize = (text: string): string[] => text.length ? text.match(/\S+\s*|^\s+/g) || [] : [];

const tokensOf = (runs: readonly TextRun[]): Token[] =>
  runs.flatMap((run) => tokenize(run.text).map((text) => ({ text, marks: run.marks })));

const marksSignature = (marks: readonly SmartMark[]): string => canonicalMarkOrder(marks).map(markKey).join("|");
const sameMarks = (left: readonly SmartMark[], right: readonly SmartMark[]): boolean => marksSignature(left) === marksSignature(right);

type Step = { readonly op: "match"; readonly before: Token; readonly after: Token } | { readonly op: "delete"; readonly token: Token } | { readonly op: "insert"; readonly token: Token };

/**
 * A token's trailing whitespace is glued on for *display* (see `tokenize`
 * above) but must not affect whether two tokens count as "the same word"
 * for matching - the very same word carries different trailing whitespace
 * depending only on whether another word happens to follow it in that
 * particular text (a word at the end of "before" has no trailing space;
 * the identical word gains one the moment "after" adds a word behind it).
 * Comparing raw `.text` would make that purely incidental difference
 * block an otherwise-correct match.
 */
const matchKey = (token: Token): string => token.text.trimEnd();

/**
 * Longest common subsequence over token match-keys (marks are compared
 * separately, after alignment - see `sameMarks` below) via plain O(n*m)
 * dynamic programming. Inputs here are bounded to one inline-content
 * owner's word count (a paragraph/heading/cell), not a whole document, so
 * Myers' O(ND) is unneeded complexity for this project's actual scale;
 * revisit only if a real profile shows otherwise.
 */
const lcsSteps = (before: readonly Token[], after: readonly Token[]): Step[] => {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = matchKey(before[i]) === matchKey(after[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (matchKey(before[i]) === matchKey(after[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      steps.push({ op: "match", before: before[i], after: after[j] });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      steps.push({ op: "delete", token: before[i] });
      i += 1;
    } else {
      steps.push({ op: "insert", token: after[j] });
      j += 1;
    }
  }
  while (i < n) { steps.push({ op: "delete", token: before[i] }); i += 1; }
  while (j < m) { steps.push({ op: "insert", token: after[j] }); j += 1; }
  return steps;
};

/** Coalesces adjacent steps of the same kind (and, for match/markChange, the same mark signature) into one segment - one token per LCS step would be needlessly fragmented for a UI. */
const coalesce = (steps: readonly Step[]): TextDiffSegment[] => {
  const segments: TextDiffSegment[] = [];
  for (const step of steps) {
    if (step.op === "match") {
      const changed = !sameMarks(step.before.marks, step.after.marks);
      const last = segments[segments.length - 1];
      if (changed) {
        if (last?.op === "markChange" && sameMarks(last.before, step.before.marks) && sameMarks(last.after, step.after.marks)) {
          segments[segments.length - 1] = { ...last, text: last.text + step.after.text };
        } else {
          segments.push({ op: "markChange", text: step.after.text, before: step.before.marks, after: step.after.marks });
        }
      } else if (last?.op === "equal" && sameMarks(last.marks, step.after.marks)) {
        segments[segments.length - 1] = { ...last, text: last.text + step.after.text };
      } else {
        segments.push({ op: "equal", text: step.after.text, marks: step.after.marks });
      }
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.op === step.op && sameMarks(last.marks, step.token.marks)) {
      segments[segments.length - 1] = { ...last, text: last.text + step.token.text };
    } else {
      segments.push({ op: step.op, text: step.token.text, marks: step.token.marks });
    }
  }
  return segments;
};

/**
 * Diffs two sequences of `{text, marks}` runs (the flattened inline content
 * of one node) at word granularity. A token never spans a run boundary, so
 * it can never straddle two different mark sets by construction.
 */
export const diffTextRuns = (before: readonly TextRun[], after: readonly TextRun[]): TextDiffSegment[] =>
  coalesce(lcsSteps(tokensOf(before), tokensOf(after)));
