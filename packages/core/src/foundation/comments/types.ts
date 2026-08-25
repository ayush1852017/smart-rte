import type { AnnotationRange } from "../annotations/types.js";

/**
 * One message in a comment thread. The first reply (index 0) is the
 * thread's opening comment, not a distinct "comment" type layered on top -
 * a thread with exactly one reply is what most people mean by "a comment,"
 * and every subsequent reply is a normal continuation of the same
 * conversation. Modeling it as one list, not "comment + replies[]", means
 * there is exactly one code path for "add a message to a thread" instead
 * of two slightly-different ones.
 */
export interface CommentReply {
  readonly id: string;
  readonly authorId: string;
  readonly text: string;
  readonly createdAt: number;
}

/**
 * A comment thread anchored to a Phase 8c `AnnotationRange`. Threaded
 * replies (single flat list, see `CommentReply`'s own doc comment);
 * resolution is thread-level state (`resolved: true`), not deletion - a
 * resolved thread's replies remain in `list()` for a host that wants to
 * show a resolved-comments history, and only an explicit `remove()` call
 * (a distinct, more destructive action) actually discards a thread.
 *
 * `range` is always a well-formed `AnnotationRange` - never null, even
 * once the ids it names no longer exist in the document (see
 * `rebase.ts`'s orphan handling). Whether a thread is currently anchored
 * to real content is derived on demand via `resolveAnnotationRange`,
 * exactly like every other `AnnotationRange` consumer - not stored as a
 * separate flag that could drift out of sync with the document.
 */
export interface CommentThread {
  readonly id: string;
  readonly range: AnnotationRange;
  readonly resolved: boolean;
  readonly replies: readonly CommentReply[];
}
