import { useMemo, useState } from "react";
import { ClassicEditor, type CanonicalEditorRuntime, type CommentProvider, type CommentThread, type DocumentVersion, type MediaItem, type MediaProvider, type StructuralSuggestion, type SuggestionProvider, type VersionProvider } from "smartrte-react";
import CanonicalSurface from "./CanonicalSurface";
import ClipboardCapture from "./ClipboardCapture";
import Gate13ReplaySurface from "./Gate13ReplaySurface";

const sha256Hex = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createReferenceMediaProvider = (): MediaProvider => {
  const library = new Map<string, { id: string; url: string; title: string; mimeType?: string; sizeBytes?: number; hashHex: string; license?: MediaItem["license"] }>();
  return {
    async upload(file, options) {
      if (options?.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      const id = `playground-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // The playground has no upload backend. Return a stable HTTPS URL so
      // the reference provider exercises the same persisted-URL contract as
      // a host backend; blob previews are intentionally transient only.
      const url = `https://media.playground.test/${encodeURIComponent(id)}/${encodeURIComponent(file.name)}`;
      // MediaManager.tsx's client-side duplicate detection calls
      // search({hashHex}) before every upload - without storing and
      // filtering by hashHex here, every existing item would spuriously
      // match once the library is non-empty, since a missing filter is
      // treated as "no constraint" by the filter below.
      const hashHex = await sha256Hex(file);
      // Deterministic fixture license metadata for a real-provider-shaped
      // e2e check of docs/bugs/media-details-old-editor-field-parity.md's
      // auto-population claim (CanonicalAuthorityEditor.tsx's
      // selectFromMediaManager) - a plain upload has none, matching every
      // real "fresh upload" case; only this specific filename pattern
      // simulates a host whose provider already has license data for an
      // asset (a library item, not something invented per-upload).
      const license = /^licensed-/.test(file.name)
        ? { author: "Jane Doe", licenseType: "CC BY", sourceUrl: "https://example.test/license", workName: "A lovely test photo" } : undefined;
      library.set(id, { id, url, title: file.name, mimeType: file.type, sizeBytes: file.size, hashHex, license });
      return { id, url };
    },
    async search(query, filters = {}, page = 1) {
      const needle = query.trim().toLowerCase();
      const pageSize = filters.pageSize || 50;
      return [...library.values()]
        .filter((item) => (!needle || item.title.toLowerCase().includes(needle))
          && (!filters.mimePrefix || item.mimeType?.startsWith(filters.mimePrefix))
          && (!filters.hashHex || item.hashHex === filters.hashHex))
        .slice(Math.max(0, page - 1) * pageSize, page * pageSize);
    },
    async remove(id) {
      library.delete(id);
    },
  };
};

const createReferenceVersionProvider = (): VersionProvider => {
  const store = new Map<string, DocumentVersion>();
  return {
    async save(version) {
      store.set(version.id, version);
      return { id: version.id, createdAt: version.createdAt, ...(version.label ? { label: version.label } : {}), ...(version.authorId ? { authorId: version.authorId } : {}) };
    },
    async list() {
      return [...store.values()].map((version) => ({
        id: version.id, createdAt: version.createdAt,
        ...(version.label ? { label: version.label } : {}), ...(version.authorId ? { authorId: version.authorId } : {}),
      }));
    },
    async load(id) {
      const version = store.get(id);
      if (!version) throw new Error(`Unknown version id: ${id}`);
      return version;
    },
    async remove(id) {
      store.delete(id);
    },
  };
};

const createReferenceCommentProvider = (): CommentProvider => {
  const store = new Map<string, CommentThread>();
  return {
    async list() {
      return [...store.values()];
    },
    async save(thread) {
      store.set(thread.id, thread);
    },
    async remove(id) {
      store.delete(id);
    },
  };
};

const createReferenceSuggestionProvider = (): SuggestionProvider => {
  const store = new Map<string, StructuralSuggestion>();
  return {
    async list() {
      return [...store.values()];
    },
    async save(suggestion) {
      store.set(suggestion.id, suggestion);
    },
    async remove(id) {
      store.delete(id);
    },
  };
};

function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("clipboardCapture")) return <ClipboardCapture />;
  if (params.has("gate13Replay")) return <Gate13ReplaySurface />;
  if (params.has("canonical")) return <CanonicalSurface />;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const mediaProvider = useMemo(createReferenceMediaProvider, []);
  const versionProvider = useMemo(createReferenceVersionProvider, []);
  const commentProvider = useMemo(createReferenceCommentProvider, []);
  const suggestionProvider = useMemo(createReferenceSuggestionProvider, []);
  const canonicalAuthority = params.has("canonicalAuthority");
  const requestedBlocks = Number(params.get("blocks") || 1);
  const blocks = Number.isFinite(requestedBlocks) ? Math.max(1, Math.min(10_000, Math.floor(requestedBlocks))) : 1;
  const replayAtomValue = '<p><img src="https://media.playground.test/replay-image.png" alt="Replay image" width="160" height="90"></p>';
  const defaultValue = canonicalAuthority
    ? params.has("sessionReplayAtom") ? replayAtomValue : params.has("sessionReplay") ? "<p>seed</p>" : Array.from({ length: blocks }, (_, index) => `<p>${index === 0 ? "Canonical product editor" : `block ${index}`}</p>`).join("")
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
        versionProvider={versionProvider}
        commentProvider={commentProvider}
        suggestionProvider={suggestionProvider}
        authorId="playground-user"
        value={!canonicalAuthority && params.has("sessionReplayAtom") ? replayAtomValue : !canonicalAuthority && params.has("sessionReplay") ? "<p>seed</p>" : undefined}
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
