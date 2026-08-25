import React, { useState } from "react";
import { listInlineSuggestions } from "smartrte-core/foundation";
import type { SmartDocument, StructuralSuggestion } from "smartrte-core/foundation";

const formatTimestamp = (createdAt: number): string => new Date(createdAt).toLocaleString();

export interface SuggestionPanelProps {
  open: boolean;
  onClose: () => void;
  document: SmartDocument;
  structuralSuggestions: readonly StructuralSuggestion[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Set when "Suggest insertion" was just clicked at a real caret position - renders a compose box for the proposed text. */
  pendingInsert: boolean;
  onSubmitInsert: (text: string) => void;
  onAcceptInline: (id: string) => void;
  onRejectInline: (id: string) => void;
  onAcceptStructural: (suggestion: StructuralSuggestion) => void;
  onRejectStructural: (suggestion: StructuralSuggestion) => void;
  busyId: string | null;
}

/**
 * Docked side panel listing every pending suggestion - both inline
 * (discovered fresh each render via listInlineSuggestions, since those
 * live as marks inside `document` itself, not a separate list the way
 * comments/versions do) and structural (an explicit prop, since those are
 * an out-of-band record like CommentThread). Non-modal, same reasoning as
 * CommentThreadPanel: reviewing shouldn't block continuing to edit nearby.
 */
export function SuggestionPanel(props: SuggestionPanelProps) {
  const {
    open, onClose, document, structuralSuggestions, activeId, onSelect,
    pendingInsert, onSubmitInsert, onAcceptInline, onRejectInline, onAcceptStructural, onRejectStructural, busyId,
  } = props;
  const [draft, setDraft] = useState("");

  if (!open) return null;

  const inline = listInlineSuggestions(document);
  const submitInsert = () => {
    const text = draft.trim();
    if (!text) return;
    onSubmitInsert(text);
    setDraft("");
  };
  const isEmpty = inline.length === 0 && structuralSuggestions.length === 0;

  return (
    <div
      role="complementary"
      aria-label="Suggestions"
      data-srte-suggestion-panel="true"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 320, maxWidth: "90vw",
        background: "var(--srte-modal-bg)", color: "var(--srte-modal-text)",
        borderLeft: "1px solid var(--srte-border-light)", boxShadow: "var(--srte-menu-shadow)",
        display: "flex", flexDirection: "column", zIndex: 70,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
        <div style={{ fontWeight: 600 }}>Suggestions</div>
        <button type="button" aria-label="Close suggestions" onClick={onClose}>✕</button>
      </div>

      {pendingInsert && (
        <div data-srte-suggestion-compose="true" style={{ padding: "10px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Suggest inserting…"
            rows={2}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--srte-border)", borderRadius: 6, background: "var(--srte-input-bg)", color: "var(--srte-input-text)", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" data-srte-suggestion-compose-submit="true" disabled={!draft.trim()} onClick={submitInsert}>Suggest</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}>
        {isEmpty && <div style={{ color: "var(--srte-text-muted)", padding: "12px 0" }}>No pending suggestions.</div>}
        {inline.map((entry) => (
          <div
            key={entry.id}
            data-srte-suggestion-entry={entry.id}
            onClick={() => onSelect(entry.id)}
            style={{ padding: "10px 0", borderBottom: "1px solid var(--srte-border-light)", outline: activeId === entry.id ? "2px solid var(--srte-primary)" : "none" }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>{entry.authorId} suggests {entry.kind === "insert" ? "inserting" : "deleting"}</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>&quot;{entry.text}&quot;</div>
            <div style={{ fontSize: 11, color: "var(--srte-text-muted)" }}>{formatTimestamp(entry.createdAt)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" data-srte-suggestion-accept={entry.id} disabled={busyId === entry.id} onClick={(event) => { event.stopPropagation(); onAcceptInline(entry.id); }}>Accept</button>
              <button type="button" data-srte-suggestion-reject={entry.id} disabled={busyId === entry.id} onClick={(event) => { event.stopPropagation(); onRejectInline(entry.id); }} style={{ color: "var(--srte-danger)" }}>Reject</button>
            </div>
          </div>
        ))}
        {structuralSuggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            data-srte-suggestion-entry={suggestion.id}
            onClick={() => onSelect(suggestion.id)}
            style={{ padding: "10px 0", borderBottom: "1px solid var(--srte-border-light)", outline: activeId === suggestion.id ? "2px solid var(--srte-primary)" : "none" }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>{suggestion.authorId} suggests removing this block</div>
            <div style={{ fontSize: 11, color: "var(--srte-text-muted)" }}>{formatTimestamp(suggestion.createdAt)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" data-srte-suggestion-accept={suggestion.id} disabled={busyId === suggestion.id} onClick={(event) => { event.stopPropagation(); onAcceptStructural(suggestion); }}>Accept</button>
              <button type="button" data-srte-suggestion-reject={suggestion.id} disabled={busyId === suggestion.id} onClick={(event) => { event.stopPropagation(); onRejectStructural(suggestion); }} style={{ color: "var(--srte-danger)" }}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
