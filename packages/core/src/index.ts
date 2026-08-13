// The package root is the canonical, framework-agnostic public API: the
// foundation document model and editing engine, and nothing else. Everything
// built on the pre-canonical model (legacyCommands/*, plugins/*, the
// html/markdown compatibility layers, and the discriminated-union model
// types in model.ts et al.) lives exclusively behind "smartrte-core/legacy"
// - see legacy/index.ts. Do not re-add those exports here; that flat
// re-export used to defeat the whole point of the /legacy subpath by making
// the same symbols reachable from the root import too.
export * from "./foundation/index.js";
