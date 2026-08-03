import { useState } from "react";
import { ClassicEditor } from "smartrte-react";
import CanonicalSurface from "./CanonicalSurface";

function App() {
  if (new URLSearchParams(window.location.search).has("canonical")) return <CanonicalSurface />;
  const [theme, setTheme] = useState<"light" | "dark">("light");

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
        theme={theme}
        minHeight={200}
        maxHeight={400}
        onChange={(html) => console.log("Classic HTML:", html)}
      />
    </div>
  );
}

export default App;
