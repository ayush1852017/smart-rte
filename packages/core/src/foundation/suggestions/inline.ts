import { createNodeId, isTextNode } from "../identity.js";
import { comparePos } from "../positions.js";
import { applyMarkCommand } from "../marks/commands.js";
import type { MarkCommandContext } from "../marks/types.js";
import type { ResolvedScope } from "../scope/types.js";
import type { SmartDocument, SmartMark, SmartNode, SmartOperation, SmartPos, SmartRange } from "../types.js";
import type { SuggestionKind } from "./types.js";

export interface SuggestSpanParams {
  readonly authorId: string;
  readonly id?: string;
  readonly createdAt?: number;
}

const suggestionMark = (kind: SuggestionKind, params: SuggestSpanParams): SmartMark => ({
  type: "suggestion",
  attrs: { id: params.id || createNodeId(), authorId: params.authorId, kind, createdAt: params.createdAt ?? Date.now() },
});

/**
 * Builds a single insertText operation carrying a fresh "insert"-kind
 * suggestion mark alongside whatever other marks the caller wants (e.g.
 * storedMarks/bold). The text is inserted for real - track-changes mode
 * means the document contains the real, live content immediately, tagged
 * for later accept/reject, not a deferred change.
 */
export const suggestInsertOperation = (
  pos: SmartPos,
  text: string,
  params: SuggestSpanParams,
  extraMarks: readonly SmartMark[] = [],
): SmartOperation => ({
  type: "insertText",
  pos,
  text,
  marks: [...extraMarks, suggestionMark("insert", params)],
});

/**
 * Marks a selection's content with a "delete"-kind suggestion instead of
 * actually deleting it - the content stays in the document (rendered
 * struck-through) until the suggestion is accepted. Reuses
 * applyMarkCommand directly: a suggestion mark is, mechanically, just
 * another mark, so the existing per-owner range splitting/exclusion
 * machinery already does exactly what's needed for a selection spanning
 * multiple paragraphs.
 */
export const suggestDeleteCommand = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: SuggestSpanParams,
  ctx: MarkCommandContext,
): SmartOperation[] => applyMarkCommand(document, scope, { markType: "suggestion", attrs: suggestionMark("delete", params).attrs }, ctx);

/**
 * The single-range counterpart to suggestDeleteCommand, for a caller that
 * already has a concrete single-owner SmartRange in hand (e.g. the input
 * pipeline's ambient track-changes mode) and has no ResolvedScope to
 * resolve - one addMark operation, no scope/positions machinery involved.
 */
export const suggestDeleteRangeOperation = (range: SmartRange, params: SuggestSpanParams): SmartOperation => ({
  type: "addMark", range, mark: suggestionMark("delete", params),
});

export interface SuggestionRun {
  readonly ownerNodeId: string;
  readonly range: SmartRange;
  readonly mark: SmartMark;
  readonly text: string;
}

/**
 * Finds every contiguous run of text carrying a suggestion mark with the
 * given id, anywhere in the document - not scoped to a caret position
 * (unlike resolveMarkRun), since accept/reject is driven by a UI marker
 * click, not necessarily a caret inside the run. A suggestion can in
 * principle be split across owners by an intervening structural edit
 * (rare), so this returns one entry per owner it's found in, not
 * assuming a single contiguous span.
 */
export const findSuggestionRuns = (document: SmartDocument, id: string): SuggestionRun[] => {
  const runs: SuggestionRun[] = [];
  const visit = (node: SmartNode, path: number[]) => {
    if (isTextNode(node)) return;
    const children = node.children || [];
    if (children.some((child) => isTextNode(child))) {
      let offset = 0;
      let current: { from: number; mark: SmartMark; text: string } | null = null;
      const flush = (to: number) => {
        if (current) runs.push({ ownerNodeId: node.id, range: { from: { path: [...path], offset: current.from }, to: { path: [...path], offset: to } }, mark: current.mark, text: current.text });
        current = null;
      };
      children.forEach((child) => {
        const width = isTextNode(child) ? child.text.length : 1;
        const mark = isTextNode(child) ? child.marks?.find((candidate) => candidate.type === "suggestion" && candidate.attrs?.id === id) : undefined;
        if (mark && isTextNode(child)) current = current ? { ...current, text: current.text + child.text } : { from: offset, mark, text: child.text };
        else flush(offset);
        offset += width;
      });
      flush(offset);
    }
    children.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(document, []);
  return runs;
};

// deleteText ops targeting the same owner must run back-to-front, or an
// earlier deletion shifts the offsets a later one still expects.
const byDescendingPosition = (a: SuggestionRun, b: SuggestionRun): number => -comparePos(a.range.from, b.range.from);

/** Accept: "insert" runs keep their text (mark stripped); "delete" runs are actually removed. */
export const acceptSuggestionCommand = (document: SmartDocument, id: string): SmartOperation[] =>
  [...findSuggestionRuns(document, id)].sort(byDescendingPosition).map((run) => run.mark.attrs?.kind === "delete"
    ? { type: "deleteText" as const, pos: run.range.from, text: run.text }
    : { type: "removeMark" as const, range: run.range, mark: run.mark });

/** Reject: "insert" runs are removed (the proposed addition never happened); "delete" runs keep their text (mark stripped). */
export const rejectSuggestionCommand = (document: SmartDocument, id: string): SmartOperation[] =>
  [...findSuggestionRuns(document, id)].sort(byDescendingPosition).map((run) => run.mark.attrs?.kind === "insert"
    ? { type: "deleteText" as const, pos: run.range.from, text: run.text }
    : { type: "removeMark" as const, range: run.range, mark: run.mark });

export interface InlineSuggestionSummary {
  readonly id: string;
  readonly authorId: string;
  readonly kind: SuggestionKind;
  readonly createdAt: number;
  /** Concatenation of every run's text sharing this id, in document order - a display preview, not authoritative content. */
  readonly text: string;
}

/** One entry per distinct suggestion id found anywhere in the document - the panel-listing counterpart to findSuggestionRuns' by-id lookup. */
export const listInlineSuggestions = (document: SmartDocument): InlineSuggestionSummary[] => {
  const summaries = new Map<string, InlineSuggestionSummary>();
  const visit = (node: SmartNode) => {
    if (isTextNode(node)) return;
    (node.children || []).forEach((child) => {
      if (isTextNode(child)) {
        const mark = child.marks?.find((candidate) => candidate.type === "suggestion");
        if (mark?.attrs) {
          const id = String(mark.attrs.id);
          const existing = summaries.get(id);
          summaries.set(id, {
            id,
            authorId: String(mark.attrs.authorId),
            kind: mark.attrs.kind as SuggestionKind,
            createdAt: Number(mark.attrs.createdAt),
            text: (existing?.text || "") + child.text,
          });
        }
      }
      visit(child);
    });
  };
  visit(document);
  return [...summaries.values()];
};
