export type SuggestionKind = "insert" | "delete";

/**
 * Attrs carried on the "suggestion" text mark (Phase 12a §2.3, hybrid
 * architecture per user decision 2026-08-24): an inline suggestion is real
 * content in the live document, tagged the same way bold/italic/link are,
 * rather than a separate not-yet-applied proposal. "insert" marks text that
 * was actually inserted, pending acceptance; "delete" marks text that is
 * still present but proposed for removal. This is deliberately NOT a
 * separate SuggestionThread-style out-of-band record the way CommentThread
 * is - reusing the marks pipeline means split/merge/undo/rendering all
 * already work for free (see marks/dom.ts, operations.ts's generic mark
 * carry-through).
 */
export interface SuggestionMarkAttrs {
  readonly id: string;
  readonly authorId: string;
  readonly kind: SuggestionKind;
  readonly createdAt: number;
}
