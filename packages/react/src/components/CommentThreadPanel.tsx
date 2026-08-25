import React, { useState } from "react";
import type { AnnotationRange, CommentThread } from "smartrte-core/foundation";

const formatTimestamp = (createdAt: number): string => new Date(createdAt).toLocaleString();

export interface CommentThreadPanelProps {
  open: boolean;
  onClose: () => void;
  threads: readonly CommentThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** Set when "Add comment" was just clicked against a valid, non-collapsed selection - renders a compose box for a brand-new thread. */
  pendingRange: AnnotationRange | null;
  onCreateThread: (text: string) => void;
  onReply: (threadId: string, text: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDelete: (threadId: string) => void;
  busyThreadId: string | null;
}

/**
 * Docked side panel, not a blocking modal like `VersionHistoryPanel`/
 * `MediaManager` - a comment thread is meant to be read and replied to
 * while continuing to edit nearby, not a full-attention dialog. Threads
 * whose range no longer resolves aren't distinguished here with a special
 * flag (per `CommentThread`'s own doc comment, "orphaned" is derived, not
 * stored) - a host wanting to visually flag them can cross-reference
 * `CommentMarkers`' own resolution, which already only renders markers for
 * threads that still resolve.
 */
export function CommentThreadPanel(props: CommentThreadPanelProps) {
  const { open, onClose, threads, activeThreadId, onSelectThread, pendingRange, onCreateThread, onReply, onResolve, onDelete, busyThreadId } = props;
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  if (!open) return null;

  const visible = threads.filter((thread) => showResolved || !thread.resolved);

  const submitCompose = () => {
    const text = draft.trim();
    if (!text) return;
    onCreateThread(text);
    setDraft("");
  };

  const submitReply = (threadId: string) => {
    const text = (replyDrafts[threadId] || "").trim();
    if (!text) return;
    onReply(threadId, text);
    setReplyDrafts((current) => ({ ...current, [threadId]: "" }));
  };

  return (
    <div
      role="complementary"
      aria-label="Comments"
      data-srte-comment-panel="true"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 320, maxWidth: "90vw",
        background: "var(--srte-modal-bg)", color: "var(--srte-modal-text)",
        borderLeft: "1px solid var(--srte-border-light)", boxShadow: "var(--srte-menu-shadow)",
        display: "flex", flexDirection: "column", zIndex: 70,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
        <div style={{ fontWeight: 600 }}>Comments</div>
        <button type="button" aria-label="Close comments" onClick={onClose}>✕</button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13, color: "var(--srte-text-muted)", borderBottom: "1px solid var(--srte-border-light)" }}>
        <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
        Show resolved
      </label>

      {pendingRange && (
        <div data-srte-comment-compose="true" style={{ padding: "10px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment…"
            rows={3}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--srte-border)", borderRadius: 6, background: "var(--srte-input-bg)", color: "var(--srte-input-text)", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button type="button" data-srte-comment-compose-submit="true" disabled={!draft.trim()} onClick={submitCompose}>Comment</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}>
        {visible.length === 0 && <div style={{ color: "var(--srte-text-muted)", padding: "12px 0" }}>No comments yet.</div>}
        {visible.map((thread) => (
          <div
            key={thread.id}
            data-srte-comment-thread={thread.id}
            onClick={() => onSelectThread(thread.id)}
            style={{
              padding: "10px 0", borderBottom: "1px solid var(--srte-border-light)",
              opacity: thread.resolved ? 0.6 : 1,
              outline: activeThreadId === thread.id ? "2px solid var(--srte-primary)" : "none",
            }}
          >
            {thread.replies.map((reply) => (
              <div key={reply.id} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{reply.authorId}</div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{reply.text}</div>
                <div style={{ fontSize: 11, color: "var(--srte-text-muted)" }}>{formatTimestamp(reply.createdAt)}</div>
              </div>
            ))}

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                data-srte-comment-resolve={thread.id}
                disabled={busyThreadId === thread.id}
                onClick={(event) => { event.stopPropagation(); onResolve(thread.id, !thread.resolved); }}
              >
                {thread.resolved ? "Reopen" : "Resolve"}
              </button>
              <button
                type="button"
                data-srte-comment-delete={thread.id}
                disabled={busyThreadId === thread.id}
                onClick={(event) => { event.stopPropagation(); onDelete(thread.id); }}
                style={{ color: "var(--srte-danger)" }}
              >
                Delete
              </button>
            </div>

            {!thread.resolved && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
                <input
                  value={replyDrafts[thread.id] || ""}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Enter") submitReply(thread.id); }}
                  placeholder="Reply…"
                  style={{ flex: 1, padding: "5px 7px", border: "1px solid var(--srte-border)", borderRadius: 6, background: "var(--srte-input-bg)", color: "var(--srte-input-text)" }}
                />
                <button type="button" data-srte-comment-reply-submit={thread.id} disabled={!(replyDrafts[thread.id] || "").trim()} onClick={() => submitReply(thread.id)}>
                  Reply
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
