import { useState } from "react";
import { ClassicEditor, type CanonicalEditorRuntime } from "smartrte-react";
import CanonicalSurface from "./CanonicalSurface";
import ClipboardCapture from "./ClipboardCapture";

function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("clipboardCapture")) return <ClipboardCapture />;
  if (params.has("canonical")) return <CanonicalSurface />;
  const [theme, setTheme] = useState<"light" | "dark">("light");
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
