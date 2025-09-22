let _wasm: any | null = null
let _initialized = false
const _editors = new Set<any>()

export async function initSmartRTE(): Promise<void> {
  if (_initialized && _wasm) return;
  // @ts-ignore
  let jsUrl: any = '../pkg/smart_rte_wasm.js';
  try {
    // Ensure dev servers don't cache the JS glue when WASM changes
    // @ts-ignore
    const u = new URL('../pkg/smart_rte_wasm.js', import.meta.url);
    try { u.searchParams.set('t', String(Date.now())); } catch {}
    jsUrl = u as any;
  } catch {}
  // @ts-ignore
  const mod = await import(/* @vite-ignore */ jsUrl);
  if (typeof (mod as any).default === 'function') {
    // Explicitly pass the wasm URL so bundlers serve the asset correctly
    // @ts-ignore
    const wasmUrl = new URL('../pkg/smart_rte_wasm_bg.wasm', import.meta.url);
    // Cache-bust in dev to avoid stale wasm/js mismatch
    try { wasmUrl.searchParams.set('t', String(Date.now())); } catch {}
    await (mod as any).default({ module_or_path: wasmUrl });
  }
  _wasm = mod;
  _initialized = true;
}

export function createEditor(): any {
  if (!_wasm) throw new Error('SmartRTE wasm not initialized. Call initSmartRTE() first.');
  const e = new _wasm.Editor();
  try { _editors.add(e); } catch {}
  return e;
}

export function createEditorFromJSON(json: string): any {
  if (!_wasm) throw new Error('SmartRTE wasm not initialized. Call initSmartRTE() first.');
  const e = _wasm.Editor.from_json(json);
  try { _editors.add(e); } catch {}
  return e;
}

export type WasmModule = {
  Editor: new () => any;
};

// Hot Module Replacement: dispose wasm on module swap to avoid stale memory
// Vite
// @ts-ignore
if (import.meta && (import.meta as any).hot) {
  // @ts-ignore
  (import.meta as any).hot.dispose(() => {
    try {
      // Free any tracked editor instances to avoid stale pointers after HMR
      for (const e of Array.from(_editors)) {
        try { e.free?.(); } catch {}
        try { _editors.delete(e); } catch {}
      }
      _wasm = null;
      _initialized = false;
    } catch {}
  });
}
