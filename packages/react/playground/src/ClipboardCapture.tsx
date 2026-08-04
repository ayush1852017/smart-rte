import { useMemo, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { importDocxDocumentWithMammoth } from "../../src/adapters/docxFormat.js";
import { serializeSmartDocument } from "../../src/adapters/domSmartDocument.js";

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
  provenance?: {
    kind: "clipboard-capture" | "docx-reference";
    originalFileName?: string;
    warning?: string;
  };
}

const isCapturedClipboardFixture = (value: unknown): value is CapturedClipboardFixture => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CapturedClipboardFixture>;
  return candidate.fixtureVersion === 1
    && typeof candidate.source === "string"
    && Array.isArray(candidate.types)
    && Boolean(candidate.representations)
    && typeof candidate.representations === "object";
};

function safeFixtureName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "clipboard";
}

export default function ClipboardCapture() {
  const [source, setSource] = useState("word-windows");
  const [platform, setPlatform] = useState("");
  const [contentDescription, setContentDescription] = useState("");
  const [fixture, setFixture] = useState<CapturedClipboardFixture | null>(null);
  const [message, setMessage] = useState("");
  const [importingDocx, setImportingDocx] = useState(false);
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
      provenance: { kind: "clipboard-capture" },
    });
    setMessage("Captured the browser clipboard payload verbatim.");
  };

  const importCaptureJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isCapturedClipboardFixture(parsed)) throw new Error("The JSON is not a Smart RTE clipboard capture fixture.");
      setFixture(parsed);
      setSource(parsed.source);
      setPlatform(parsed.platform || "");
      setContentDescription(parsed.contentDescription || "");
      setMessage(`Imported genuine capture JSON: ${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import capture JSON.");
    }
  };

  const importDocxReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingDocx(true);
    try {
      const imported = await importDocxDocumentWithMammoth(await file.arrayBuffer(), document);
      const html = serializeSmartDocument(imported);
      const textContainer = document.createElement("div");
      textContainer.innerHTML = html;
      const plainText = textContainer.textContent || "";
      const referenceSource = `${safeFixtureName(source)}-docx-reference`;
      setFixture({
        fixtureVersion: 1,
        source: referenceSource,
        platform: platform.trim(),
        contentDescription: contentDescription.trim() || file.name,
        capturedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        types: ["text/html", "text/plain"],
        representations: { "text/html": html, "text/plain": plainText },
        files: [{ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified }],
        provenance: {
          kind: "docx-reference",
          originalFileName: file.name,
          warning: "Generated through Mammoth from a DOCX file. This is not Word clipboard HTML and cannot clear the captured-corpus gate.",
        },
      });
      setMessage("Imported DOCX as reference content. It is not a Windows/macOS clipboard capture.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import DOCX reference.");
    } finally {
      setImportingDocx(false);
    }
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
      <section style={{ background: "#fff8dc", border: "1px solid #d6a700", borderRadius: 8, marginBottom: 20, padding: 16 }}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>Import an existing fixture or Word file</h2>
        <p>
          Import capture JSON from another computer to preserve its genuine clipboard payload. A DOCX import is also available
          for parser/reference testing, but a DOCX file does not contain the HTML that Word places on the Windows or macOS clipboard.
          Therefore DOCX reference imports cannot clear the real Word clipboard gate.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label>
            Import genuine capture JSON
            <input aria-label="Import genuine capture JSON" accept=".json,application/json" onChange={importCaptureJson} type="file" style={{ display: "block" }} />
          </label>
          <label>
            Import DOCX reference
            <input aria-label="Import DOCX reference" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={importingDocx} onChange={importDocxReference} type="file" style={{ display: "block" }} />
          </label>
        </div>
        {message && <p role="status" style={{ marginBottom: 0 }}>{message}</p>}
      </section>
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
        {fixture && <span>{fixture.provenance?.kind === "docx-reference" ? "DOCX reference contains" : "Captured"} {fixture.types.join(", ") || "no declared MIME types"}</span>}
      </div>
      <label style={{ display: "block", marginTop: 20 }}>
        Captured JSON preview
        <textarea readOnly value={serialized} style={{ display: "block", fontFamily: "monospace", minHeight: 320, width: "100%" }} />
      </label>
    </main>
  );
}
