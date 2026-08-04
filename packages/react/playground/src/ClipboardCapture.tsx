import { useMemo, useState, type ClipboardEvent } from "react";

interface CapturedClipboardFile {
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

interface CapturedClipboardFixture {
  fixtureVersion: 1;
  source: string;
  platform: string;
  contentDescription: string;
  capturedAt: string;
  userAgent: string;
  types: string[];
  representations: Record<string, string>;
  files: CapturedClipboardFile[];
}

function safeFixtureName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "clipboard";
}

export default function ClipboardCapture() {
  const [source, setSource] = useState("word-windows");
  const [platform, setPlatform] = useState("");
  const [contentDescription, setContentDescription] = useState("");
  const [fixture, setFixture] = useState<CapturedClipboardFixture | null>(null);
  const serialized = useMemo(() => fixture ? `${JSON.stringify(fixture, null, 2)}\n` : "", [fixture]);

  const capture = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const types = Array.from(clipboard.types);
    const representations: Record<string, string> = {};
    for (const type of types) {
      if (type !== "Files") representations[type] = clipboard.getData(type);
    }
    setFixture({
      fixtureVersion: 1,
      source: source.trim(),
      platform: platform.trim(),
      contentDescription: contentDescription.trim(),
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      types,
      representations,
      files: Array.from(clipboard.files, (file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    });
  };

  const download = () => {
    if (!fixture) return;
    const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFixtureName(source)}-${safeFixtureName(contentDescription)}.clipboard.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={{ margin: "0 auto", maxWidth: 1100, padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>Phase 8a clipboard fixture capture</h1>
      <p>
        This page records the clipboard payload verbatim. It does not render, sanitize, or normalize it.
        Paste only test content that is safe to store in the repository.
      </p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <label>
          Source
          <select value={source} onChange={(event) => setSource(event.target.value)} style={{ display: "block", width: "100%" }}>
            <option value="native-smart-rte">Native Smart RTE</option>
            <option value="word-windows">Word (Windows)</option>
            <option value="word-macos">Word (macOS)</option>
            <option value="google-docs">Google Docs</option>
            <option value="plain-text">Plain text</option>
            <option value="excel">Excel</option>
            <option value="google-sheets">Google Sheets</option>
            <option value="markdown-plain-text">Markdown source</option>
            <option value="generic-web">Generic web page</option>
          </select>
        </label>
        <label>
          Source platform/version
          <input value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="Windows 11 / Word 365" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Content description
          <input value={contentDescription} onChange={(event) => setContentDescription(event.target.value)} placeholder="nested-bullets" style={{ display: "block", width: "100%" }} />
        </label>
      </div>
      <div
        aria-label="Clipboard capture target"
        contentEditable
        onPaste={capture}
        suppressContentEditableWarning
        style={{ border: "2px dashed #646cff", borderRadius: 8, marginTop: 20, minHeight: 150, padding: 20 }}
      >
        Focus here and paste. The browser's default paste is prevented.
      </div>
      <div style={{ alignItems: "center", display: "flex", gap: 12, marginTop: 16 }}>
        <button type="button" disabled={!fixture} onClick={download}>Download exact JSON payload</button>
        {fixture && <span>Captured {fixture.types.join(", ") || "no declared MIME types"}</span>}
      </div>
      <label style={{ display: "block", marginTop: 20 }}>
        Captured JSON preview
        <textarea readOnly value={serialized} style={{ display: "block", fontFamily: "monospace", minHeight: 320, width: "100%" }} />
      </label>
    </main>
  );
}
