import React, { useCallback, useEffect, useState } from "react";
import { resolveAnnotationRange } from "smartrte-core/foundation";
import type { CommentThread, ModelDomMapping, PositionLookup } from "smartrte-core/foundation";

export interface CommentMarkersProps {
  positions: PositionLookup;
  mapping: ModelDomMapping;
  containerElement: HTMLElement;
  threads: readonly CommentThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}

interface HighlightRect { threadId: string; resolved: boolean; left: number; top: number; width: number; height: number }
interface Badge { threadId: string; resolved: boolean; replyCount: number; left: number; top: number }

/**
 * Live inline markers for comment threads, following `TableResizeHandles`'
 * precedent (Phase 12a §1.2 finding): comments need many simultaneous
 * persistent anchors, not the single-instance overlay pattern the other
 * popovers use, so this measures real DOM rects from the live document and
 * re-measures via ResizeObserver/MutationObserver/scroll, exactly like that
 * component's column/row handles do for table boundaries.
 *
 * A thread's range is resolved fresh on every recompute via
 * `resolveAnnotationRange` (not cached) - it is the authoritative "is this
 * thread still anchored to real content" check, matching every other
 * AnnotationRange consumer. A thread whose range no longer resolves (fully
 * orphaned - the content it anchored to is gone) renders nothing here; it
 * still exists in `threads` for a host's thread-list UI to surface.
 */
export function CommentMarkers({ positions, mapping, containerElement, threads, activeThreadId, onSelectThread }: CommentMarkersProps) {
  const [rects, setRects] = useState<HighlightRect[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);

  const recompute = useCallback(() => {
    if (!threads.length) {
      setRects([]);
      setBadges([]);
      return;
    }
    const nextRects: HighlightRect[] = [];
    const nextBadges: Badge[] = [];
    threads.forEach((thread) => {
      const range = resolveAnnotationRange(thread.range, positions);
      if (!range) return;
      const fromDom = mapping.posToDom(range.from);
      const toDom = mapping.posToDom(range.to);
      if (!fromDom || !toDom) return;
      const domRange = containerElement.ownerDocument.createRange();
      try {
        domRange.setStart(fromDom.node, fromDom.offset);
        domRange.setEnd(toDom.node, toDom.offset);
      } catch {
        return;
      }
      const clientRects = [...domRange.getClientRects()];
      clientRects.forEach((rect) => {
        nextRects.push({ threadId: thread.id, resolved: thread.resolved, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      });
      const anchor = clientRects[clientRects.length - 1] || domRange.getBoundingClientRect();
      nextBadges.push({ threadId: thread.id, resolved: thread.resolved, replyCount: thread.replies.length, left: anchor.right, top: anchor.top });
    });
    setRects(nextRects);
    setBadges(nextBadges);
  }, [positions, mapping, containerElement, threads]);

  useEffect(() => {
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(containerElement);
    const mutationObserver = new MutationObserver(recompute);
    mutationObserver.observe(containerElement, { childList: true, subtree: true, characterData: true });
    const ownerWindow = containerElement.ownerDocument.defaultView;
    ownerWindow?.addEventListener("scroll", recompute, true);
    ownerWindow?.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      ownerWindow?.removeEventListener("scroll", recompute, true);
      ownerWindow?.removeEventListener("resize", recompute);
    };
  }, [containerElement, recompute]);

  return (
    <div data-srte-comment-markers="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 55 }}>
      {rects.map((rect, index) => (
        <div
          key={`${rect.threadId}-${index}`}
          data-srte-comment-highlight={rect.threadId}
          onPointerDown={() => onSelectThread(rect.threadId)}
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            background: rect.resolved
              ? "var(--srte-comment-highlight-resolved, rgba(148, 148, 148, 0.18))"
              : activeThreadId === rect.threadId
                ? "var(--srte-comment-highlight-active, rgba(245, 180, 0, 0.55))"
                : "var(--srte-comment-highlight, rgba(245, 180, 0, 0.28))",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      ))}
      {badges.map((badge) => (
        <button
          key={badge.threadId}
          type="button"
          aria-label={badge.resolved ? "Open resolved comment thread" : "Open comment thread"}
          data-srte-comment-badge={badge.threadId}
          onClick={() => onSelectThread(badge.threadId)}
          style={{
            position: "fixed",
            left: badge.left + 4,
            top: badge.top - 4,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            border: "1px solid var(--srte-border, #d0d0d0)",
            background: badge.resolved
              ? "var(--srte-comment-badge-resolved, #e3e3e3)"
              : activeThreadId === badge.threadId
                ? "var(--srte-primary)"
                : "var(--srte-comment-badge, #f5b400)",
            color: badge.resolved ? "#555" : "#1a1300",
            fontSize: 10,
            lineHeight: "14px",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        >
          {badge.replyCount}
        </button>
      ))}
    </div>
  );
}
