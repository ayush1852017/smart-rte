"use client";
import { useEffect, useMemo, useState } from "react";
import { SmartEditor } from "@smartrte/react";
import { initSmartRTE, createEditor } from "@smartrte/core-wasm";
// import { createHttpStorageClient } from "@smartrte/storage-s3";

export default function Page() {
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState<any>(null);

  useEffect(() => {
    (async () => {
      await initSmartRTE();
      const e = createEditor();
      setEditor(e);
      setReady(true);
    })();
    // Avoid calling free() here; Next + StrictMode can double-unmount in dev
    return () => {};
  }, []);

  const storage = undefined as any;

  if (!ready) return <div>Loading WASM…</div>;
  return (
    <div>
      <h1>SmartRTE Demo</h1>
      <SmartEditor editor={editor} storage={storage} />
    </div>
  );
}
