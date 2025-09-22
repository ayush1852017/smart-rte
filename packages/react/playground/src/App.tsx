import { useEffect, useState } from "react";
import { SmartEditor, ClassicEditor } from "../../src";
import { initSmartRTE, createEditor } from "@smartrte/core-wasm";

type WasmEditor = {
  insert_table: (rows: number, cols: number) => void;
  add_row: (at: number) => void;
  add_col: (at: number) => void;
  move_row: (from: number, to: number) => void;
  move_col: (from: number, to: number) => void;
  merge_cells: (sr: number, sc: number, er: number, ec: number) => void;
  split_cell: (r: number, c: number) => void;
  set_cell_style: (r: number, c: number, styleJson: string) => void;
  set_cell_text: (r: number, c: number, text: string) => void;
  set_column_width: (col: number, px: number) => void;
  set_freeze: (header: boolean, first_col: boolean) => void;
  to_json: () => string;
  to_html: () => string;
  to_markdown: () => string;
  to_delta: () => string;
  from_delta: (deltaJson: string) => void;
  undo: () => void;
  redo: () => void;
  free?: () => void;
};

function App() {
  const [editor, setEditor] = useState<WasmEditor | null>(null);
  const [mode, setMode] = useState<"classic" | "smart">("classic");

  useEffect(() => {
    let mounted = true;
    let localEditor: WasmEditor | null = null;
    (async () => {
      await initSmartRTE();
      if (!mounted) return;
      localEditor = createEditor() as WasmEditor;
      setEditor(localEditor);
    })();
    return () => {
      mounted = false;
      // Do not call free() here; React StrictMode may unmount/remount twice in dev
      // and the loader's HMR dispose will free editors if needed.
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Smart RTE: React + Rust/WASM</h2>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <label>
          <input
            type="radio"
            name="mode"
            value="classic"
            checked={mode === "classic"}
            onChange={() => setMode("classic")}
          />
          ClassicEditor (CKEditor-like)
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            value="smart"
            checked={mode === "smart"}
            onChange={() => setMode("smart")}
          />
          SmartEditor (WASM)
        </label>
      </div>
      {/* <SmartEditor
        value={undefined} // JSON string preferred
        onChange={(val) => console.log(val)}
        format="json" // 'json' | 'html' | 'markdown' (emit format)
        allowImages // optional
      /> */}
      {mode === "classic" ? (
        <ClassicEditor
          minHeight={200}
          maxHeight={400}
          onChange={(html) => console.log("Classic HTML:", html)}
        />
      ) : editor ? (
        <SmartEditor editor={editor} maxHeight={400} minHeight={200} />
      ) : (
        <div>Loading WASM…</div>
      )}
    </div>
  );
}

export default App;
