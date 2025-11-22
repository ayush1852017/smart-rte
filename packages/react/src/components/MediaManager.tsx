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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (activeTab === "library") {
      performSearch();
    }
  }, [open, activeTab]);

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
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          width: 820,
          maxWidth: "90vw",
          maxHeight: "86vh",
          borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
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
            borderBottom: "1px solid #eee",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setActiveTab("upload")}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #ddd",
                background: activeTab === "upload" ? "#f2f2f2" : "#fff",
              }}
            >
              Upload
            </button>
            <button
              onClick={() => setActiveTab("library")}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #ddd",
                background: activeTab === "library" ? "#f2f2f2" : "#fff",
              }}
            >
              Library
            </button>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{ color: "#b00020", padding: "8px 14px" }}>{error}</div>
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
                border: "2px dashed #bbb",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#333",
                background: "#fafafa",
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
                  border: "1px solid #ddd",
                  borderRadius: 6,
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
                <button
                  key={it.id || it.url}
                  onClick={() => {
                    onSelect(it);
                    onClose();
                  }}
                  title={it.title || it.url}
                  style={{
                    display: "block",
                    border: "1px solid #eee",
                    borderRadius: 8,
                    padding: 6,
                    background: "#fff",
                    textAlign: "center",
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
                  <div style={{ fontSize: 11, marginTop: 6, color: "#333" }}>
                    {it.width && it.height ? `${it.width}×${it.height}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
