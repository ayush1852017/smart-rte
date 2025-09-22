import { useCallback, useEffect, useRef, useState } from "react";

export function useEditorSync(editor: any) {
  const [doc, setDoc] = useState<any>({ nodes: [] });
  const retryRef = useRef<number | null>(null);

  const sync = useCallback(() => {
    if (!editor) return;
    // Skip if the wasm Editor was freed (HMR/unmount). __wbg_ptr === 0 means invalid.
    try {
      if (typeof editor.__wbg_ptr === 'number' && editor.__wbg_ptr === 0) return;
    } catch {}
    // Defer to next tick to avoid wasm RefCell re-entrancy when calling
    // multiple &mut self methods back-to-back in the same event loop turn.
    setTimeout(() => {
      try {
        if (typeof editor.__wbg_ptr === 'number' && editor.__wbg_ptr === 0) return;
        const json = editor.to_json();
        const parsed = JSON.parse(json);
        setDoc(parsed);
      } catch (err) {
        // Avoid noisy logs during HMR/refresh when wasm may be temporarily invalid
        // Retry once shortly after in case module just reloaded
        if (retryRef.current) window.clearTimeout(retryRef.current);
        retryRef.current = window.setTimeout(() => {
          try { if (typeof editor.__wbg_ptr === 'number' && editor.__wbg_ptr !== 0) { const j = editor.to_json(); setDoc(JSON.parse(j)); } } catch {}
          retryRef.current = null;
        }, 100);
      }
    }, 0);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    try {
      if (typeof editor.__wbg_ptr === 'number' && editor.__wbg_ptr === 0) return;
    } catch {}
    sync();
  }, [editor, sync]);

  return { doc, setDoc, sync };
}
