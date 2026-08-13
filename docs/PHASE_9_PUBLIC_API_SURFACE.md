# Phase 9 §2.5 — Public API surface + headless facade

Status: complete. This finalizes the export tables for `smartrte-core` and `smartrte-react`, and formalizes the headless (non-React) editing facade.

## `smartrte-core` — three entry points, now cleanly separated

| Subpath | Contains | Consumers |
|---|---|---|
| `smartrte-core` (root, `.`) | The canonical, framework-agnostic document model and editing engine — a straight re-export of `./foundation`. This is the primary public API for new consumers. | `smartrte-react`'s production components and runtime |
| `smartrte-core/foundation` | Identical content to root, exposed under an explicit name for consumers who want to be unambiguous about depending on the canonical model specifically. | `smartrte-react`'s `index.ts` (docx/pdf/fidelity re-exports), `CanonicalEditorRuntime`, `CanonicalAuthorityEditor` |
| `smartrte-core/legacy` | Everything built on the pre-canonical, discriminated-union document model: `model.ts`, `command.ts`, `editor.ts`, `marks.ts`, `plugin.ts`, `preset.ts`, `history.ts`, `selection.ts`, `listScope.ts`, `listPresets.ts`, `selectionMapping.ts`, `schema.ts`, `table.ts`, `transaction.ts`, `tree.ts`, `legacyCommands/*`, `plugins/*`, `html/compatibility.ts`, `markdown/compatibility.ts`. Compatibility-only; not used by any production editing path since Phase 8b retired `LegacyClassicEditor`. | `smartrte-react`'s internal shadow-comparator test harnesses only (`legacyListShadowComparator.ts`, `legacyTableEngine.ts`, `legacyAtomEngine.ts`, `pluginRuntime.ts`'s legacy-plugin-config bridge, a handful of DOM-bridge adapters retained for those comparators) |

### What was actually wrong, and the fix

`packages/core/src/index.ts` was re-exporting `./foundation/index.js` **and** the entire legacy-model surface (`model.js`, `legacyCommands/*`, `plugins/*`, `html/compatibility.js`, `markdown/compatibility.js`, etc.) flatly, side by side. `packages/core/src/legacy/index.ts` already existed as a complete, correctly-curated barrel for exactly this legacy surface, with a doc comment stating the intent explicitly ("Contract names are deliberately prefixed with `Legacy`; the canonical unprefixed names belong to the package root/foundation kernel") — but root's flat re-export defeated that isolation by making every legacy symbol *also* reachable from the plain `smartrte-core` import, unprefixed and indistinguishable from canonical symbols. `scripts/check-foundation-boundary.mjs` already enforced part of this boundary (flagging a fixed list of `Legacy*`-prefixed type names imported from the bare root) but didn't - and couldn't, from an import-site check alone - prevent the barrel itself from over-exporting.

Fix: `packages/core/src/index.ts` now contains a single re-export, `export * from "./foundation/index.js";`, with a comment explaining why nothing else belongs there. No changes were needed to `legacy/index.ts` - it was already correct.

### Fallout fixed

- `packages/core/src/foundation/list/index.ts` was missing `export * from "./presets.js";` — `FOUNDATION_SMART_LIST_PRESETS` and friends existed but were never reachable from `smartrte-core/foundation` at all (only via internal relative imports within `packages/core`). This was a real, pre-existing gap in the foundation barrel, surfaced by pruning root's accidental fallback path. Fixed by adding the export.
- Two files depended on legacy/foundation symbols leaking through the root barrel instead of importing them from their real home:
  - `packages/react/src/adapters/legacyListShadowComparator.ts` imported entirely-foundation symbols (`createList`, `indentList`, `SmartDocument`, etc.) from bare `"smartrte-core"` — switched to `"smartrte-core/foundation"`.
  - `packages/react/src/components/CanonicalAuthorityEditor.tsx` imported `SMART_LIST_PRESETS` (a legacy-named alias for `FOUNDATION_SMART_LIST_PRESETS`) from bare `"smartrte-core"` — switched to importing `FOUNDATION_SMART_LIST_PRESETS` directly from `"smartrte-core/foundation"`.
- 20 test files inside `packages/core/src` (root-level legacy-model tests and `plugins/*.test.ts`/`legacyCommands/*.test.ts`) imported their own package's legacy exports via the relative root barrel (`"./index.js"` / `"../index.js"`) rather than `"./legacy/index.js"` / `"../legacy/index.js"`. Not a public-API issue (internal to `packages/core`'s own test suite), but broken by the same prune; fixed by repointing each to the legacy barrel. `packages/core`'s `tsconfig.json` excludes `*.test.ts` from `tsc -p tsconfig.json`, which is why `pnpm --filter smartrte-core build` stayed green throughout — the breakage only showed up at `vitest run`.

No production consumer, and no `smartrte-react` public export, depended on the flat root/legacy duplication. Verified via `pnpm --filter smartrte-core build`, `pnpm --filter smartrte-react exec tsc --noEmit`, full core suite (486/486), full react suite (97/97), and all `scripts/check-*.mjs` contract gates.

## `smartrte-react` — unchanged shape, now resting on a correct core boundary

`packages/react/src/index.ts` was already a deliberately curated barrel (components, the canonical editor runtime, media/theme/plugin APIs, and explicit named re-exports from `smartrte-core/foundation` for the format codecs and fidelity table). It needed no structural change here; it now simply forwards a `smartrte-core/foundation` that is properly boundary-checked.

## Headless facade: `CanonicalEditorRuntime` / `SmartEditorHandle`

`packages/react/src/canonicalEditorRuntime.ts` already had zero React imports and a complete, DOM-only public surface (`getValue`, `replaceValue`, `isDirty`, `markSaved`, `getRevision`, `focus`, `executeOperations`, `createCheckpoint`, `restoreCheckpoint`, plus `mount`/`unmount` for attaching to a plain `HTMLElement`). This *is* the headless facade — no new wrapper class was introduced; per this project's standing convention against premature abstraction, wrapping an already-adequate, already-framework-agnostic class in another layer would have added nothing.

What was missing was proof: nothing in the test suite demonstrated the framework-independence claim empirically. Added `packages/react/src/canonicalEditorRuntime.headless.smoke.test.ts` — a test file that imports only `vitest` and `canonicalEditorRuntime.js`/`smartrte-core/foundation` types (no `react`, no `react-dom`, no `@testing-library/react`), mounts a runtime to a plain `document.createElement("div")`, drives a real edit through `editor.transact`, and asserts on rendered DOM text plus the full `SmartEditorHandle` contract (value get/replace, dirty/saved/revision tracking, checkpoint round-trip). 3/3 passing.

`CanonicalEditorRuntime` stays in `smartrte-react` rather than relocating to `smartrte-core` - it is documented and tested as framework-agnostic, but physically living in the react package matches where it's actually shipped and consumed today, and a relocation would add packaging risk for no behavioral change.
