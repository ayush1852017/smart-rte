import React, { useCallback, useEffect, useState } from "react";
import { resolveAnnotationRange } from "smartrte-core/foundation";
import type { ModelDomMapping, PositionLookup, StructuralSuggestion } from "smartrte-core/foundation";

export interface StructuralSuggestionMarkersProps {
  positions: PositionLookup;
  mapping: ModelDomMapping;
  containerElement: HTMLElement;
  suggestions: readonly StructuralSuggestion[];
  activeSuggestionId: string | null;
  onSelectSuggestion: (id: string) => void;
}

interface MarkerRect { id: string; left: number; top: number; width: number; height: number }

/**
 * Live overlay for structural (whole-node) suggestions, the AnnotationRange
 * half of Phase 12a §2.3's hybrid architecture. Simpler than CommentMarkers:
 * a structural suggestion always anchors to exactly one whole node, so this
 * measures that single element's own rect directly via mapping.nodeToDom
 * rather than resolving a Range across DOM text positions. Re-measures on
 * the same ResizeObserver/MutationObserver/scroll schedule as
 * CommentMarkers/TableResizeHandles, for the same reason: live DOM layout
 * changes independently of React re-renders.
 */
export function StructuralSuggestionMarkers({ positions, mapping, containerElement, suggestions, activeSuggestionId, onSelectSuggestion }: StructuralSuggestionMarkersProps) {
  const [rects, setRects] = useState<MarkerRect[]>([]);

  const recompute = useCallback(() => {
    if (!suggestions.length) {
      setRects([]);
      return;
    }
    const next: MarkerRect[] = [];
    suggestions.forEach((suggestion) => {
      if (!resolveAnnotationRange(suggestion.range, positions)) return;
      const element = mapping.nodeToDom(suggestion.range.startId);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      next.push({ id: suggestion.id, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    });
    setRects(next);
  }, [positions, mapping, suggestions]);

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
    <div data-srte-suggestion-markers="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 55 }}>
      {rects.map((rect) => (
        <div
          key={rect.id}
          data-srte-suggestion-highlight={rect.id}
          onPointerDown={() => onSelectSuggestion(rect.id)}
          style={{
            position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            background: activeSuggestionId === rect.id ? "var(--srte-suggestion-highlight-active, rgba(220, 60, 60, 0.28))" : "var(--srte-suggestion-highlight, rgba(220, 60, 60, 0.14))",
            borderLeft: "3px solid var(--srte-suggestion-border, #dc3c3c)",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}
