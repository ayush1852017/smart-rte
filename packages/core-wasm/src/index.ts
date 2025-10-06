import initWasm, * as wasmModule from '../pkg/smart_rte_wasm.js'

let _wasm: any | null = null
let _initialized = false
const _editors = new Set<any>()

export async function initSmartRTE(): Promise<void> {
  if (_initialized && _wasm) return;
  // For wasm-pack --target bundler, calling the default init with no args allows bundlers to resolve the WASM asset
  await initWasm();
  _wasm = wasmModule as any;
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
