import React, { useEffect, useState } from "react";
import { diffVersions, foundationSchema, type DocumentDiff } from "smartrte-core/foundation";
import type { VersionListEntry, VersionProvider } from "../versionProvider.js";
import type { CanonicalEditorRuntime } from "../canonicalEditorRuntime.js";

const formatTimestamp = (createdAt: number): string => new Date(createdAt).toLocaleString();

const summarize = (diff: DocumentDiff): string => {
  const parts = [
    diff.added.length ? `${diff.added.length} added` : null,
    diff.removed.length ? `${diff.removed.length} removed` : null,
    diff.changed.length ? `${diff.changed.length} edited` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : "No differences";
};

export function VersionHistoryPanel(props: {
  open: boolean;
  onClose: () => void;
  runtime: CanonicalEditorRuntime;
  versionProvider: VersionProvider;
  authorId?: string;
}) {
  const { open, onClose, runtime, versionProvider, authorId } = props;
  const [versions, setVersions] = useState<VersionListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Selecting two entries computes a diff summary between them - order is
  // the order they were selected in, not list order, so "swap" reads
  // naturally when a user picks the later one first.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [diffSummary, setDiffSummary] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions([...(await versionProvider.list())].sort((a, b) => b.createdAt - a.createdAt));
    } catch {
      setError("Failed to load version history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCompareIds([]);
    setDiffSummary(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (compareIds.length !== 2) {
      setDiffSummary(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    (async () => {
      try {
        const [a, b] = await Promise.all(compareIds.map((id) => versionProvider.load(id)));
        if (cancelled) return;
        setDiffSummary(summarize(diffVersions(a, b, foundationSchema)));
      } catch {
        if (!cancelled) setError("Failed to compare the selected versions.");
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareIds]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const version = runtime.saveVersion({ ...(label.trim() ? { label: label.trim() } : {}), ...(authorId ? { authorId } : {}) });
      await versionProvider.save(version);
      setLabel("");
      await refresh();
    } catch {
      setError("Failed to save this version.");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (entry: VersionListEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const target = await versionProvider.load(entry.id);
      runtime.restoreVersion(target);
      // Non-destructive restore (Phase 12a spec's explicit recommendation):
      // record the restoration as a new, forward-moving version rather
      // than silently rewriting/discarding anything - the version list
      // only ever grows. Nothing between the current state and the
      // restore target is ever deleted; every prior version, including
      // whatever was live immediately before this restore, is still
      // reachable by restoring to it directly.
      const recorded = runtime.saveVersion({
        label: `Restored: ${entry.label || formatTimestamp(entry.createdAt)}`,
        ...(authorId ? { authorId } : {}),
      });
      await versionProvider.save(recorded);
      await refresh();
    } catch {
      setError("Failed to restore this version.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (entry: VersionListEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      await versionProvider.remove(entry.id);
      setCompareIds((current) => current.filter((id) => id !== entry.id));
      await refresh();
    } catch {
      setError("Failed to delete this version.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      if (current.length < 2) return [...current, id];
      return [current[1], id];
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "var(--srte-modal-backdrop)",
        backdropFilter: "var(--srte-modal-backdrop-filter)", WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Version history"
        data-srte-version-history="true"
        style={{
          background: "var(--srte-modal-bg)", color: "var(--srte-modal-text)",
          width: 560, maxWidth: "90vw", maxHeight: "86vh",
          borderRadius: 10, boxShadow: "var(--srte-menu-shadow)",
          display: "flex", flexDirection: "column",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
          <div style={{ fontWeight: 600 }}>Version history</div>
          <button type="button" aria-label="Close version history" onClick={onClose}>✕</button>
        </div>

        {error && <div style={{ color: "var(--srte-danger)", padding: "8px 14px" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--srte-border-light)" }}>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label this version (optional)"
            style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--srte-border)", borderRadius: 6, background: "var(--srte-input-bg)", color: "var(--srte-input-text)" }}
          />
          <button type="button" data-srte-version-save="true" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save version"}
          </button>
        </div>

        {compareIds.length === 2 && (
          <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--srte-text-muted)", borderBottom: "1px solid var(--srte-border-light)" }} data-srte-version-diff-summary="true">
            {diffLoading ? "Comparing…" : diffSummary}
          </div>
        )}

        <div style={{ overflowY: "auto", padding: "8px 14px 14px" }}>
          {loading && <div style={{ color: "var(--srte-text-muted)", padding: "8px 0" }}>Loading…</div>}
          {!loading && versions.length === 0 && <div style={{ color: "var(--srte-text-muted)", padding: "8px 0" }}>No saved versions yet.</div>}
          {versions.map((entry) => (
            <div
              key={entry.id}
              data-srte-version-entry={entry.id}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                borderBottom: "1px solid var(--srte-border-light)",
              }}
            >
              <input
                type="checkbox"
                aria-label={`Select ${entry.label || formatTimestamp(entry.createdAt)} for comparison`}
                checked={compareIds.includes(entry.id)}
                onChange={() => toggleCompare(entry.id)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label || "Untitled version"}</div>
                <div style={{ fontSize: 11, color: "var(--srte-text-muted)" }}>{formatTimestamp(entry.createdAt)}</div>
              </div>
              <button type="button" data-srte-version-restore={entry.id} disabled={busyId === entry.id} onClick={() => void handleRestore(entry)}>
                Restore
              </button>
              <button
                type="button"
                data-srte-version-delete={entry.id}
                disabled={busyId === entry.id}
                onClick={() => void handleDelete(entry)}
                style={{ color: "var(--srte-danger)" }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
