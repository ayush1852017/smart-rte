# Capability presets added (Sootr migration gap #3: no way to disable individual toolbar capabilities)

**Status:** Fixed (feature addition)
**Area:** react / plugin system
**First reported:** 2026-08-30, `docs/SOOTR_MIGRATION_READINESS.md` gap #3 - Sootr's MCQ/Anomaly/PYEQ editors all pass `enableTable={false}` to the old editor; the new `ClassicEditorProps` declared `table`/`media`/`formula` as `unknown` and silently discarded them.
**Related files:** `packages/react/src/capabilityPresets.ts` (new), `packages/react/src/canonicalEditorRuntime.ts`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`, `packages/react/src/components/ClassicEditorAuthority.tsx`, `packages/core/src/foundation/plugin/registry.ts` (unmodified - already supported this), `packages/core/src/foundation/editor.ts` (see `disable-safety-restore-never-wired.md`, fixed alongside this)

## Decision

Product decision (not a discovered defect): build a real, reusable, host-facing capability-preset mechanism rather than silently letting tables become available everywhere. A small extension of Phase 10's existing plugin registry (`createPluginRegistry`), not new architecture - `FoundationEditor` already accepted a custom `schema`/`commands`/`keyboardShortcuts`/`contextMenu` via `FoundationEditorOptions` since Phase 10; nothing in the react layer ever exposed a way to reach for it per-instance.

**Scope note**: the requesting prompt's own illustrative example proposed a "Simple" preset excluding tables *and* media *and* formula. Real, verified Sootr usage (`docs/SOOTR_MIGRATION_READINESS.md` §1.3) contradicts this - every real call site (MCQ, Anomaly, PYEQ) passes `enableMedia enableFormula` as true and only ever varies `enableTable`. Built "simple" to exclude only the `table` plugin, matching the actual confirmed need rather than the prompt's illustrative wording, since building it the other way would have broken working media/formula capability in exactly the contexts this feature is meant to serve. Flagged explicitly here as a deliberate deviation, not an oversight.

## Design

- `packages/react/src/capabilityPresets.ts`: `EditorCapabilityPreset = "simple" | "full"`. `"simple"` excludes the `table` plugin; `"full"` excludes nothing (byte-identical to today's only behavior). Registries are built via the existing `createPluginRegistry(builtInPlugins.filter(...), {baseSchema, schemaVersion})` and cached per preset (a handful of fixed presets, not rebuilt per editor instance).
- `CanonicalEditorRuntime` gained a `preset?: EditorCapabilityPreset` construction option (default omitted = "full", passing no custom `schema`/`commands`/etc. to `FoundationEditor`, so `options.schema || foundationSchema` keeps every existing consumer on the exact same singleton object as before - verified via reference equality in `capabilityPresets.test.ts`).
- `CanonicalAuthorityEditorProps` gained `preset?: EditorCapabilityPreset`, construction-time-only (matches `defaultValue`'s own uncontrolled-after-mount contract - the runtime is created once and retained across re-renders, same as today).
- **Toolbar gating**: the toolbar is hand-authored JSX, not driven by the plugin registry's own `toolbar` contributions the way the context menu already is (the context menu loop iterates `runtime.editor.contextMenu`, which already reflects whichever registry was actually used - no extra work needed there). A new `tablesEnabled = Boolean(runtime.editor.schema.nodes.table)` gates the "Insert table" `ToolbarGroup` and the `MobileMoreMenu`'s table-tools section.
- `ClassicEditorProps.table` (previously `unknown`, discarded) is now `boolean`, mapped to `preset ?? (table === false ? "simple" : "full")` - an explicit `preset` prop wins if both are given. `media`/`formula` remain accepted-but-ignored (`unknown`) - nothing in this project's history has ever needed them to vary independently of each other (both are owned by the single "atom" plugin today; splitting it is out of scope, since nothing needs it yet).

## A real bug found while verifying this feature's own round-trip-safety claim

See `disable-safety-restore-never-wired.md`: verifying "content created under Full, loaded under Simple, must round-trip safely as `unknown`, and restore exactly when loaded back under Full" surfaced that the *restore* half of Phase 10's disable-safety contract (`restoreUnknownNodes`/`restoreUnknownMarks`) was built and tested in isolation but never actually called from any real document-load path. Fixed in the same pass, since this feature's own correctness claim depends on it.

## A second real bug found while verifying paste specifically

`packages/core/src/foundation/clipboard/pipeline.ts`'s `parseClipboardPayload` hardcoded `foundationSchema` (the full built-in set) in its `repair()` call, ignoring whatever schema the pasting editor instance was actually constructed with. Under a "simple"-preset editor, pasting a `<table>` would have incorrectly validated as real content instead of demoting to `unknown` - defeating disable-safety specifically for the paste/drop path, even though the same content loaded via `replaceValue`/the initial document already correctly demoted. Fixed: `ClipboardPipelineOptions` gained an optional `schema` field (defaults to `foundationSchema` for full backward compatibility); `surface/input.ts`'s two `parseClipboardPayload` call sites (paste, drop) now pass `schema: this.editor.schema`.

## Regression coverage

- `packages/react/src/capabilityPresets.test.ts`: "full" is reference-identical to the pre-existing default; "simple" excludes exactly the table node types while keeping list/block/atom (media+formula); registries are cached per preset; the full round-trip (full → persist → load under simple, confirm demoted to `unknown` → persist → load under full again, confirm restored exactly) through the real `CanonicalEditorRuntime`.
- `packages/react/src/components/CanonicalAuthorityEditor.presets.test.tsx`: the "Insert table" button and "Table tools" dropdown are absent under `preset="simple"`, present under the default.
- `packages/react/src/components/ClassicEditorAuthority.test.tsx`: `table={false}` selects "simple"; an explicit `preset` prop overrides it.
- `packages/core/src/foundation/clipboard/pipeline.test.ts`: pasting a `<table>` under a schema without the table plugin demotes to `unknown` (was: incorrectly validated against the full schema regardless).

Suite counts after this pass: core 724/724, react 140/140, `pnpm run lint` clean, full 3-browser e2e 519/528 (2 already-documented pre-existing Firefox flakes, 7 deliberate skips, no new failures).

## Related/similar issues

`disable-safety-restore-never-wired.md`, `classic-editor-onchange-object-instead-of-string.md` (fixed in the same pass, both discovered/required by this same body of work). `docs/SOOTR_MIGRATION_READINESS.md` (the investigation that scoped this feature).
