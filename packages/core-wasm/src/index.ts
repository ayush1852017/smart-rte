let _wasm: any | null = null
let _initialized = false

export async function initSmartRTE(): Promise<void> {
  if (_initialized && _wasm) return;
  // @ts-ignore
  const mod = await import('../pkg/smart_rte_wasm.js');
  if (typeof (mod as any).default === 'function') {
    // Explicitly pass the wasm URL so bundlers serve the asset correctly
    // @ts-ignore
    const wasmUrl = new URL('../pkg/smart_rte_wasm_bg.wasm', import.meta.url);
    await (mod as any).default({ module_or_path: wasmUrl });
  }
  _wasm = mod;
  _initialized = true;
}

export function createEditor(): any {
  if (!_wasm) throw new Error('SmartRTE wasm not initialized. Call initSmartRTE() first.');
  return new _wasm.Editor();
}

export function createEditorFromJSON(json: string): any {
  if (!_wasm) throw new Error('SmartRTE wasm not initialized. Call initSmartRTE() first.');
  return _wasm.Editor.from_json(json);
}

export type WasmModule = {
  Editor: new () => any;
};
