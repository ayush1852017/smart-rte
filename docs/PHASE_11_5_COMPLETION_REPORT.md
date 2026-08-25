# Phase 11.5 completion report — Editor Interaction Surface

**Verdict: Complete.** All five work items closed. Gate 1 (Phase 11 v1.0 shipped) was satisfied by the product owner's explicit waiver of the four remaining Tier 1–3 manual-validation items (`docs/PHASE_ROADMAP_8B_12B.md:126`). Gate 2 (§1.1's `MediaProvider` investigation, required before any UI code) was satisfied and produced a scope-reshaping finding — see §I.

Per `CLAUDE.md`'s standing rule, `docs/bugs/` was checked before each item; two real, previously-undiscovered bugs were found and fixed along the way (table `columnWidths` never rendered; that fix's own `:first-child` selector regression), both logged.

## A. Implemented interfaces (verbatim)

**Item 1 — Link-edit UI**
`packages/react/src/components/CanonicalAuthorityEditor.tsx` — Link toolbar button now opens `LinkEditorPopover` (previously built, tested, unwired) instead of `window.prompt`; new `linkPopover` state, `applyLink`/`removeLink` handlers, `applyMarkAttrs` extracted as a shared helper. No command-layer change — `editLinkCommand`/`resolveMarkRun`/`removeLinkCommand` were already correct.

**Item 2 — Color picker**
`packages/react/src/components/ColorPickerPopover.tsx` (new) — preset swatch grid (12 colors) plus hex input, `data-srte-color-*` test hooks. Wired into `CanonicalAuthorityEditor.tsx`'s textColor/backgroundColor toolbar buttons via new `colorPopover` state and `applyColor`, replacing `window.prompt`.

**Item 3 — Media manager UI**
`packages/react/src/mediaManagerAdapter.ts` (new) — `mediaManagerAdapterFrom(provider: MediaProvider): MediaManagerAdapter`, translating the real interface's shape into what `MediaManager.tsx` (previously built, unwired) expects. `packages/react/src/mediaProvider.ts` — additive `MediaItem.usageCount?: number`. `MediaManager.tsx` — added `remove` support (info panel Delete button; the component had none despite `MediaProvider.remove` existing), `role="dialog"`/`aria-label` on the previously-unlabeled dialog root, `type="button"`/`aria-label` on several bare buttons. `CanonicalAuthorityEditor.tsx` — new `mediaManager?: boolean` prop (default `true`); `MediaManager` renders for the `image` kind when a provider is present, `MediaPicker` otherwise (video/audio unaffected — `MediaManager.tsx` is image-only).

**Item 4 — Advanced table interaction UI**
`packages/react/src/components/TableResizeHandles.tsx` (new) — drag-handle overlay computing column/row boundaries from live cell rects via `ResizeObserver`, commit-on-release (no live preview), calling `setTableColumnWidthCommand`/`setTableRowHeightCommand`. `packages/core/src/foundation/surface/renderer.ts` — `syncNodeAttributes`'s `table` branch now renders `<colgroup>`/`<col>` from `table.attrs.columnWidths` (previously never rendered at all — `docs/bugs/table-column-width-not-rendered.md`). Row/column reorder already had toolbar buttons before this phase ("Move row up/down"/"Move column left/right"); only resize had no UI.

**Item 5 — Context menus**
`packages/core/src/foundation/plugin/types.ts` — `ContextMenuContribution` gains `scopeKinds: readonly ScopeKind[]`, mirroring `KeyboardShortcutContribution`. `packages/core/src/foundation/{marks,table,atom}/plugin.ts` — `markContextMenuContributions`/`markClearFormattingContextMenuContribution`, `tableContextMenuContributions`, `atomContextMenuContributions`; wired into `packages/core/src/foundation/plugin/builtins.ts`'s plugin list (previously zero built-in plugins populated `contextMenu` at all). `packages/core/src/foundation/editor.ts` — `FoundationEditor.contextMenu`, mirroring the existing `keyboardShortcuts` field/option. `packages/react/src/components/ContextMenu.tsx` (new) — generic position-at-cursor, keyboard-dismissible, click-outside-to-close menu. `CanonicalAuthorityEditor.tsx` — `resolveContextMenuItems()` (mirrors `surface/input.ts`'s `resolveShortcut` dispatch: try each contribution's `scopeKinds[0]`, keep it only if that scope actually resolves; generates fresh ids for `table.insertRow`/`insertColumn` per invocation, mirroring Tab's `list.indent`/`outdent` special case), `onContextMenu` handler on the editable root.

## B. Deviations from spec

- **§1.1's own premise about `toolbar` contributions was partly wrong, corrected before building item 5.** The approved plan assumed `contextMenu` contributions should be added "mirroring how toolbar contributions are already declared per plugin" — investigation found that while `marks`/`block` *do* declare `toolbar` contributions at the registry level, **nothing in `packages/react` actually reads `registry.toolbar`** — the React toolbar is entirely hardcoded buttons calling command functions directly. `keyboardShortcuts` is the only contribution kind that is both declared *and* dynamically dispatched (`surface/input.ts`'s Tab handler). Item 5 was built mirroring `keyboardShortcuts`' proven dispatch pattern instead, which required adding `scopeKinds` to `ContextMenuContribution` (a small, additive type change not in the original plan, but necessary for the same reason `KeyboardShortcutContribution` has it — a context menu, like a keyboard shortcut, is scope-gated).
- **Marks' context menu is a curated 7 of the 11 `inlineToolDeclarations`**, not all of them — `textColor`/`backgroundColor`/`fontSize`/`fontFamily`/`link` all require `attrs` a static contribution can't supply (their own `validate` functions reject an empty value) and already have dedicated popover UI; only the boolean toggles (bold/italic/underline/strikethrough/code/superscript/subscript) plus "Clear formatting" were added.
- **Table's context menu omits `splitCell`, `setHeader`, and move-row/column** — split needs dynamic ids *and* only applies to an already-merged cell (more than a scope-kind check can detect); setHeader/move already have dedicated toolbar buttons from before this phase, not duplicated.

## C. Locked decisions

- Item 5's dispatch mechanism generalizes to any future plugin's `contextMenu` contributions (third-party or built-in) without `CanonicalAuthorityEditor.tsx` needing per-commandId code, except for the two table commands needing caller-generated ids — a deliberate, narrow escape hatch matching the precedent Tab's dispatch already set.
- `usageCount` stays optional/additive per §1.1's own recommendation — no `MediaProvider` method change.
- Target/Radius atom-attribute editing controls (named in the spec's field list but identified in §1.1 as atom-schema concerns, not `MediaProvider`/`MediaManager` concerns) remain out of scope — tracked as a follow-up in §E, not silently dropped.

## D. Exit gate results

| # | Item | Result |
|---|---|---|
| 1 | Phase 11 v1.0 shipped | **Done** — explicit product-owner waiver, 2026-08-19. |
| 2 | §1.1 `MediaProvider` investigation, before any UI code | **Done** — `docs/PHASE_11_5_MEDIAPROVIDER_FINDINGS.md`, see §I. |
| 3 | Media manager UI wired, replaceable, zero cloud SDK code | **Done.** |
| 4 | Table interaction UI (click-to-edit, reorder, resize) | **Done** — click-to-edit confirmed already working via ordinary editing; reorder already had buttons; resize built. |
| 5 | Context menus dispatching to existing commands | **Done.** |
| 6 | Color picker replaces `window.prompt` | **Done.** |
| 7 | Link-edit UI reuses `resolveMarkRun`, no remove-then-recreate | **Done.** |
| 8-12 | (Verification/reporting gates) | **Done** — see §H. |

## E. Known gaps and TODOs

- **Target (link-behavior) and Radius (border-radius) atom attributes** don't exist in the schema — identified in §1.1, correctly out of scope for item 3, not built here either. A future item would add `imageAttrs` entries plus renderer support.
- **Align editing control** — `imageAttrs.align` already exists in the schema but `MediaManager.tsx`'s info panel has no control for it yet (a UI-only gap, not a data-model gap, per §1.1).
- **`table.splitCell` has no context-menu entry** — needs dynamic ids and cell-merge-state detection beyond a scope-kind check; not built this pass.
- **`ContextMenu.tsx` has no dedicated component-level unit test** — covered by three e2e tests exercising table/atom/marks dispatch across all three browsers instead. Consistent with this phase's own precedent: `ColorPickerPopover.tsx` and `TableResizeHandles.tsx` (items 2 and 4) also have e2e-only coverage, not component tests; only `LinkEditorPopover.tsx` (item 1) had a pre-existing component test, inherited rather than added this phase.

## F. Test/verification evidence

- Core: 607/607 (added 5 tests in `packages/core/src/foundation/plugin/contextMenu.test.ts`, plus item 4's `tableColumnWidth.test.ts` (3 tests) from earlier in this phase).
- React: 96/96 (item 3's `mediaManagerAdapter.test.ts`, 4 tests).
- Full 3-browser e2e (chromium/firefox/webkit): progressed 253 → 278 (Tier 1–3 close) → 281 (item 1) → 284 (item 2) → 287 (item 3) → 290 (item 4) → **299 passed / 7 skipped / 0 failed (item 5, final)**.
- `pnpm run lint` clean throughout, including `docs:plugins:check` (plugin doc generation contract).
- `packages/core` rebuilt before every `packages/react`/e2e run, per this project's stale-dist lesson.

## G. Security/privacy notes

No new attack surface: `ContextMenu.tsx` dispatches only to existing, already-security-reviewed commands via the same `PluginCommandContext` every other dispatch path uses; no new user input parsing beyond what `LinkEditorPopover`/`ColorPickerPopover` already validate (`normalizeLinkInput`, hex-pattern matching). No cloud SDK or storage-specific code was added anywhere in this phase, per the spec's explicit stop condition.

## H. Final disposition

Phase 11.5 is closed. Per §5 of the original spec, the next meaningful work is **Phase 12a — Versioning and Asynchronous Review (v1.1)**.

## I. `MediaProvider` investigation findings (§1.1)

Full findings in `docs/PHASE_11_5_MEDIAPROVIDER_FINDINGS.md`, produced before any implementation began, per the spec's explicit instruction ("Do not assume the interface is sufficient. Do not assume it's insufficient. Check."). Summary:

- **Headline finding**: `MediaManager.tsx` (395 lines — upload, library search, SHA-256 duplicate detection, full per-asset info panel) and `LinkEditorPopover.tsx` (218 lines, its own test file) were both already fully built and tested-or-testable, but never imported by `CanonicalAuthorityEditor.tsx` — the same "real code, never connected" pattern found repeatedly elsewhere in this project (Phase 10's `pluginRuntime.ts`, Tier 0's `resolveShortcut`).
- **Does `MediaProvider` need new methods? No.** The three-method interface (`upload`/`search`/`remove`) already covers everything `MediaManager.tsx` needs, including duplicate detection. The blocker was a **shape mismatch** between `MediaProvider` and `MediaManager.tsx`'s own `MediaManagerAdapter` type (batch vs. singular upload, bundled vs. positional search params) — resolved via a translation adapter (`mediaManagerAdapterFrom`), not an interface change.
- **Does `MediaItem` need extending? Yes, one field.** `usageCount?: number`, additive and optional — no existing field covered "used N times"; two ways to compute it were identified (client-side from the live document, or server-side host tracking), and the additive-optional-field approach was recommended and built, matching the package's established boundary of not doing server-side work itself.
- **Field-set gap vs. spec's list** ("Link, Target, Alt, Width, Radius, Align, License, Author, License type, Attribution text"): most fields were already present or near-equivalent; Target and Radius are missing entirely from both `MediaItem` and atom attrs (identified as atom-schema concerns, not `MediaProvider` concerns, and correctly left out of this phase — see §E); Align exists in the schema but has no editing control yet.
- This investigation reshaped item 3's real scope from "build a media library UI" to "wire, adapt, and fill real gaps in an existing one" — a materially smaller and different task than the spec's own framing implied.

## J. Old-editor comparison

No reference material for "the old Sootr editor" exists anywhere in this repository or its git history for any of the five work items — confirmed by filename search (`MediaManager.js`, `LinkEditor`, `ContextMenu`, `ColorPicker`, `TableResize`, case-insensitive) and `git log --all`, zero hits in every case. This was already established during §1.1's investigation for item 3 and held true when re-checked for items 4 and 5. Per work item:

- **2.1 Media manager UI**: nothing referenced from an old editor. `MediaManager.tsx` and the adapter pattern were built (in a prior session) against this project's own `MediaProvider`/`MediaItem` types, informed entirely by §1.1's investigation of the *existing, unwired* component already in this repo — not a port of anything external.
- **2.2 Advanced table interaction UI**: built fresh against this repo's own `occupancyGridFor`/`setTableColumnWidthCommand`/`setTableRowHeightCommand`. The `<colgroup>`/`<col>` rendering mechanism was chosen to mirror this repo's own legacy `domTableCommandBridge.ts` approach (an internal precedent, not an old-editor reference).
- **2.3 Context menus**: built fresh, no external reference. The dispatch mechanism was designed to mirror this repo's own `surface/input.ts` `resolveShortcut` pattern (an internal precedent), not anything from an old editor.
- **2.4 Color picker**: built fresh, no external reference — preset palette is this project's own choice (`ColorPickerPopover.tsx`'s own doc comment: "a representative, readable-on-both-themes preset set... a starting point a host can restyle").
- **2.5 Link-edit UI**: `LinkEditorPopover.tsx` itself predates this phase (already built and tested in this repo before Phase 11.5 began) — wiring it in referenced only this repo's own component and command layer (`editLinkCommand`, `resolveMarkRun`), not an old editor.

**Conclusion: zero old-editor reference material exists in this repository for any part of Phase 11.5**, consistent with what §1.1 already established for item 3 specifically. Every work item was either built fresh against this codebase's own existing types/commands/internal precedents, or wired from already-built-but-unwired components already living in this repo.
