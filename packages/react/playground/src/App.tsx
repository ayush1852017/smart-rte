import { useMemo, useState } from "react";
import { ClassicEditor, type CanonicalEditorRuntime, type MediaProvider } from "smartrte-react";
import CanonicalSurface from "./CanonicalSurface";
import ClipboardCapture from "./ClipboardCapture";

const createReferenceMediaProvider = (): MediaProvider => {
  const library = new Map<string, { id: string; url: string; title: string; mimeType?: string; sizeBytes?: number }>();
  return {
    async upload(file, options) {
      if (options?.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      const id = `playground-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // The playground has no upload backend. Return a stable HTTPS URL so
      // the reference provider exercises the same persisted-URL contract as
      // a host backend; blob previews are intentionally transient only.
      const url = `https://media.playground.test/${encodeURIComponent(id)}/${encodeURIComponent(file.name)}`;
      library.set(id, { id, url, title: file.name, mimeType: file.type, sizeBytes: file.size });
      return { id, url };
    },
    async search(query, filters = {}, page = 1) {
      const needle = query.trim().toLowerCase();
      const pageSize = filters.pageSize || 50;
      return [...library.values()]
        .filter((item) => (!needle || item.title.toLowerCase().includes(needle)) && (!filters.mimePrefix || item.mimeType?.startsWith(filters.mimePrefix)))
        .slice(Math.max(0, page - 1) * pageSize, page * pageSize);
    },
    async remove(id) {
      const item = library.get(id);
      library.delete(id);
    },
  };
};

function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("clipboardCapture")) return <ClipboardCapture />;
  if (params.has("canonical")) return <CanonicalSurface />;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const mediaProvider = useMemo(createReferenceMediaProvider, []);
  const canonicalAuthority = params.has("canonicalAuthority");
  const requestedBlocks = Number(params.get("blocks") || 1);
  const blocks = Number.isFinite(requestedBlocks) ? Math.max(1, Math.min(10_000, Math.floor(requestedBlocks))) : 1;
  const defaultValue = canonicalAuthority
    ? params.has("sessionReplay") ? "<p>seed</p>" : Array.from({ length: blocks }, (_, index) => `<p>${index === 0 ? "Canonical product editor" : `block ${index}`}</p>`).join("")
    : undefined;

  return (
    <div style={{
      padding: 20,
      minHeight: "100vh",
      background: theme === "dark" ? "#121212" : "#fff",
      color: theme === "dark" ? "#e0e0e0" : "#000",
      transition: "background 0.2s, color 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Smart RTE: React ClassicEditor</h2>
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid",
            cursor: "pointer",
          }}
        >
          {theme === "light" ? "Dark Mode" : "Light Mode"}
        </button>
      </div>
      <ClassicEditor
        canonicalAuthority={canonicalAuthority}
        defaultValue={defaultValue}
        mediaProvider={mediaProvider}
        value={!canonicalAuthority && params.has("sessionReplay") ? "<p>seed</p>" : undefined}
        theme={theme}
        minHeight={200}
        maxHeight={400}
        onHtmlChange={(html) => console.log("Classic HTML:", html)}
        onRuntime={(runtime) => {
          (window as Window & { __smartProductCanonical?: CanonicalEditorRuntime }).__smartProductCanonical = runtime;
        }}
      />
    </div>
  );
}

export default App;
