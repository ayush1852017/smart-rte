import React, { useEffect, useMemo, useRef, useState } from "react";

export type MediaItem = {
  id: string;
  url: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  hashHex?: string;
  createdAt?: string;
  title?: string;
  alt?: string;
  tags?: string[];
  license?: {
    author?: string;
    licenseType?: string;
    licenseText?: string;
    sourceUrl?: string;
    workName?: string;
  };
};

export type MediaSearchQuery = {
  q?: string;
  tags?: string[];
  mimePrefix?: string; // e.g. "image/"
  hashHex?: string;
  page?: number;
  pageSize?: number;
};

export type MediaManagerAdapter = {
  upload: (files: File[]) => Promise<MediaItem[]>;
  search: (query: MediaSearchQuery) => Promise<MediaItem[]>;
};

export function MediaManager(props: {
  open: boolean;
  onClose: () => void;
  adapter: MediaManagerAdapter;
  onSelect: (item: MediaItem) => void;
}) {
  const { open, onClose, adapter, onSelect } = props;
  const [activeTab, setActiveTab] = useState<"upload" | "library">("upload");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [infoItem, setInfoItem] = useState<MediaItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== "library") return;
    const timer = window.setTimeout(() => {
      performSearch();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, activeTab, query]);

  const performSearch = async () => {
    try {
      const items = await adapter.search({ q: query, mimePrefix: "image/" });
      setResults(items || []);
    } catch (e) {
      setError("Failed to search media.");
    }
  };

  const computeSha256Hex = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // Duplicate detection by content hash (best-effort, server should also verify)
      const duplicates: MediaItem[] = [];
      const toUpload: File[] = [];
      for (const f of list) {
        try {
          const hash = await computeSha256Hex(f);
          const hits = await adapter.search({ hashHex: hash });
          if (hits && hits.length) {
            duplicates.push(hits[0]);
            continue;
          }
          toUpload.push(f);
        } catch {}
      }
      if (duplicates.length) {
        // Prefer duplicates immediately
        onSelect(duplicates[0]);
        setUploading(false);
        onClose();
        return;
      }
      if (toUpload.length) {
        const uploaded = await adapter.upload(toUpload);
        if (uploaded && uploaded.length) {
          onSelect(uploaded[0]);
          onClose();
        }
      }
    } catch (e) {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--srte-modal-backdrop)",
        backdropFilter: "var(--srte-modal-backdrop-filter)",
        WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--srte-modal-bg)",
          color: "var(--srte-modal-text)",
          width: 820,
          maxWidth: "90vw",
          maxHeight: "86vh",
          borderRadius: 10,
          boxShadow: "var(--srte-menu-shadow)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid var(--srte-border-light)",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setActiveTab("upload")}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--srte-border)",
                background: activeTab === "upload" ? "var(--srte-surface-subtle)" : "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Upload
            </button>
            <button
              onClick={() => setActiveTab("library")}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--srte-border)",
                background: activeTab === "library" ? "var(--srte-surface-subtle)" : "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Library
            </button>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{ color: "var(--srte-danger)", padding: "8px 14px" }}>{error}</div>
        )}

        {activeTab === "upload" ? (
          <div style={{ padding: 16 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleUploadFiles(e.currentTarget.files)}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleUploadFiles(e.dataTransfer.files);
              }}
              style={{
                border: "2px dashed var(--srte-border)",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "var(--srte-text-muted)",
                background: "var(--srte-surface-subtle)",
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.7 : 1,
              }}
            >
              {uploading ? "Uploading…" : "Click or drag images to upload"}
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search images by name, tag, etc."
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  border: "1px solid var(--srte-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                }}
              />
              <button onClick={performSearch}>Search</button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 12,
                overflowY: "auto",
                paddingBottom: 16,
              }}
            >
              {results.map((it) => (
                <div
                  key={it.id || it.url}
                  title={it.title || it.url}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 8,
                    padding: 6,
                    background: "var(--srte-input-bg)",
                    color: "var(--srte-input-text)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(it);
                      onClose();
                    }}
                    style={{
                      border: "none",
                      padding: 0,
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <img
                      src={it.url}
                      alt={it.alt || ""}
                      style={{
                        maxWidth: "100%",
                        maxHeight: 100,
                        display: "block",
                        margin: "0 auto",
                        objectFit: "cover",
                        borderRadius: 6,
                      }}
                    />
                  </button>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--srte-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.title || it.alt || (it.width && it.height ? `${it.width}×${it.height}` : "Image")}
                    </div>
                    <button
                      type="button"
                      onClick={() => setInfoItem(it)}
                      title="Image info"
                      style={{
                        width: 24,
                        height: 24,
                        border: "1px solid var(--srte-border)",
                        borderRadius: 999,
                        background: "var(--srte-surface-subtle)",
                        color: "var(--srte-input-text)",
                        cursor: "pointer",
                        flex: "0 0 auto",
                      }}
                    >
                      i
                    </button>
                  </div>
                  {it.tags && it.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {it.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 10,
                            padding: "1px 5px",
                            borderRadius: 999,
                            background: "var(--srte-surface-subtle)",
                            color: "var(--srte-text-muted)",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {infoItem && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--srte-modal-backdrop)",
              backdropFilter: "var(--srte-modal-backdrop-filter)",
              WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 90,
            }}
            onClick={() => setInfoItem(null)}
          >
            <div
              style={{
                width: 420,
                maxWidth: "90vw",
                background: "var(--srte-modal-bg)",
                color: "var(--srte-modal-text)",
                borderRadius: 10,
                boxShadow: "var(--srte-menu-shadow)",
                padding: 16,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>Image info</div>
                <button type="button" onClick={() => setInfoItem(null)}>✕</button>
              </div>
              <img
                src={infoItem.url}
                alt={infoItem.alt || ""}
                style={{ maxWidth: "100%", maxHeight: 180, display: "block", margin: "0 auto 12px", borderRadius: 8 }}
              />
              {[
                ["Title", infoItem.title],
                ["Alt text", infoItem.alt],
                ["Dimensions", infoItem.width && infoItem.height ? `${infoItem.width}×${infoItem.height}` : undefined],
                ["MIME type", infoItem.mimeType],
                ["Size", infoItem.sizeBytes ? `${Math.round(infoItem.sizeBytes / 1024)} KB` : undefined],
                ["Created", infoItem.createdAt],
                ["Tags", infoItem.tags?.join(", ")],
                ["Work", infoItem.license?.workName],
                ["Author", infoItem.license?.author],
                ["License", [infoItem.license?.licenseType, infoItem.license?.licenseText].filter(Boolean).join(" - ")],
                ["Source", infoItem.license?.sourceUrl],
              ].filter(([, value]) => value).map(([label, value]) => (
                <div key={label} style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 8, fontSize: 12, marginBottom: 6 }}>
                  <div style={{ color: "var(--srte-text-muted)" }}>{label}</div>
                  <div style={{ overflowWrap: "anywhere" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
