import type { CommentThread } from "smartrte-core/foundation";

/**
 * Host-owned comment-storage boundary, mirroring `VersionProvider`/
 * `MediaProvider`'s shape and "the editor never persists anything itself"
 * contract. Unlike `VersionProvider`, there is no separate cheap-listing
 * projection: a `CommentThread` (an id, a range, a handful of short replies)
 * is already small enough that a host's `list()` can return full threads
 * directly, with no equivalent of `VersionProvider`'s envelope/entry split
 * needed to avoid shipping large payloads up front.
 *
 * `save` both creates a new thread and persists an updated one (a reply
 * added, `resolved` toggled) - the caller always passes the complete
 * `CommentThread` it wants stored, so there is one code path for both,
 * exactly like `CommentReply`'s own "one path for adding a message"
 * decision in `foundation/comments/types.ts`. There is deliberately no
 * shipped default implementation, exactly like `VersionProvider`/
 * `MediaProvider` - when a host doesn't supply one, the comments feature is
 * simply unavailable.
 */
export interface CommentProvider {
  list(): Promise<readonly CommentThread[]>;
  save(thread: CommentThread): Promise<void>;
  remove(threadId: string): Promise<void>;
}
