# Per-tool toolbar visibility - a solid, architecture-supported solution for hiding individual tools

**Status:** Fixed (feature addition)
**Area:** react / toolbar (`toolbarTools.ts`, new; `CanonicalAuthorityEditor.tsx`; `classic-editor-embed.tsx`)
**First reported:** 2026-09-02, "Developers should be able to hide those tools which are not for their use... If a developer have to not show to their users version history, review, video, audio etc. Then how they should do that?" followed by "I want a solid solution for all tools to toggle. Which is supported by our architecture. Shouldn't require to overwrite anything."
**Related files:** `docs/bugs/mobile-more-menu-clipped-and-missing-list-preset.md` (the exact desktop/mobile duplication gap this feature had to avoid reintroducing, for every tool this time, not just one), `docs/PLUGIN_ARCHITECTURE.md`, `packages/react/src/capabilityPresets.ts` (the deeper, schema-level mechanism this composes with, not replaces)

## The architectural gap this closes

The plugin registry (`capabilityPresets.ts`) already lets a host exclude a real document *capability* at construction time (today: the `table` plugin, via `preset="simple"`) - schema, commands, and paste-safety all correctly follow. But the **toolbar itself is hand-authored JSX**, not driven by that registry's own toolbar contributions the way the context menu already is (an existing, explicitly-flagged limitation - see `tablesEnabled`'s own doc comment in `CanonicalAuthorityEditor.tsx`). Before this fix, `table` was the *only* toolbar entry with any real on/off mechanism; `showVersionHistory`/`showReview` (added the same day, never shipped/committed) were the first attempt at a second one, as ad hoc booleans with no general shape. Video, Audio, Special characters, and every mark/paragraph/list tool had no supported way to hide them at all - a host wanting a smaller toolbar had no option but to fork the component or fight it with CSS.

## Design

A single new prop, `tools?: Partial<ToolbarTools>` (`toolbarTools.ts`, new file), with one boolean key per independently-meaningful tool (~40 keys), all defaulting to `true` - an existing consumer who never passes `tools` sees zero behavior change. `resolveToolbarTools(tools)` merges a host's partial override onto `DEFAULT_TOOLBAR_TOOLS`.

**Composes with, never replaces, existing gates** - a tool renders only if both its own `tools.X` flag is true AND any capability it structurally depends on is actually present:
- `insertTable` also requires the schema to actually have the table plugin (`tablesEnabled`, driven by `preset`) - explicitly disabling it in `tools` cannot un-exclude a plugin, and excluding the plugin via `preset` cannot be overridden back on by leaving `tools.insertTable: true`.
- `image`/`video`/`audio` also require `mediaProvider`.
- `versionHistory` also requires `versionProvider`; `comments` requires `commentProvider`; `suggestions` requires `suggestionProvider`. (This also fixes a real doc-comment/behavior drift found along the way: `versionProvider`'s own doc comment claimed "Absent hides the version-history toolbar button entirely," but the actual code only ever `disabled` it, leaving a dead grayed-out button. The new `showVersionHistoryTool`/`showCommentsTool`/`showSuggestionsTool` derived booleans finally make that claim true for all three.)

**Scoping decision, stated explicitly rather than silently decided:** purely contextual, selection-dependent actions - block move/indent/outdent, list-item indent/move/restart numbering, table row/column/cell operations, and the selected-media edit/resize/delete actions - are **not** individually toggleable. None of these have independent product meaning (there is no real case for "let people insert a table but hide its Add row action"); they stay governed solely by their owning top-level tool. Every other top-level toolbar entry, including all 4 align buttons and all 5 individual "Save as..." export formats, got its own key, per the explicit "per-individual-button" direction given for this feature.

**"Review" splits into two independent toggles, `comments` and `suggestions`** - not an arbitrary bundling choice, it maps directly onto the two already-separate providers this architecture has (`commentProvider`, `suggestionProvider`). Both stay inside one "Review" dropdown trigger (unchanged label/position), rendering whichever half(s) are actually enabled; the whole trigger disappears only if both are off, rather than leaving an empty dropdown.

**The uncommitted `showVersionHistory`/`showReview` props are retired**, folded into `tools.versionHistory`/`tools.comments`/`tools.suggestions`. Since those two props were never shipped (still sitting uncommitted in the working tree when this feature started), replacing them outright - rather than keeping both mechanisms side by side - was the correct call: keeping both would have been exactly the ad hoc, inconsistent boolean sprawl this feature exists to replace.

**Desktop/mobile parity, applied uniformly**: every gate above is applied identically to both the main toolbar row and `MobileMoreMenu`'s duplicated content, since they share the exact same JSX variables (`textStylesMenuItems`, `insertMoreMenuItems`, `listPresetSelect`, etc.) - a tool hidden on desktop is guaranteed hidden on mobile too, by construction, not by parallel maintenance. This was the precise class of bug `mobile-more-menu-clipped-and-missing-list-preset.md` fixed for one control (List preset); this feature had to avoid reintroducing it for all ~40.

**Exported publicly**: `ToolbarTools`, `DEFAULT_TOOLBAR_TOOLS`, `resolveToolbarTools` from `packages/react/src/index.ts`. Also exported `EditorCapabilityPreset` from the same file while touching it - it was usable only implicitly via `CanonicalAuthorityEditorProps['preset']` before, a pre-existing minor gap unrelated to this feature but trivial to close alongside it.

**Standalone embed** (`classic-editor-embed.tsx`, the `window.SmartRTE.ClassicEditor.init(...)` global API): gained the same `tools?: Partial<ToolbarTools>` option, replacing its own `showVersionHistory`/`showReview` fields, threaded through to the underlying `ClassicEditor` component (which already forwards unknown-to-it props via its existing `Omit<CanonicalAuthorityEditorProps, ...> & {...canonical}` spread - no explicit change needed there).

## Regression coverage

New `packages/react/src/components/CanonicalAuthorityEditor.toolbarTools.test.tsx` (jsdom, mounting the real component - matching the exact pattern already established for `preset` in `CanonicalAuthorityEditor.presets.test.tsx`, no e2e counterpart needed for the same reason that file has none: a construction-time prop, not a runtime interaction bug):
- Default (`tools` omitted) shows every tool - zero behavior change.
- A representative mark tool (Bold) confirmed absent from **both** the desktop toolbar and the mobile menu when disabled, not just one copy.
- Video/Audio/Image confirmed to require both the flag and `mediaProvider` (each independently absent still hides the tool).
- Version History confirmed to require both the flag and `versionProvider`.
- Comments/Suggestions confirmed independently toggleable, and the whole "Review" dropdown trigger confirmed to disappear once both are off.
- `insertTable` confirmed to require both the flag and the schema actually having the table plugin (`preset`).
- Disabling every "Save as..." format confirmed to hide the whole "Save a copy" dropdown trigger, not leave it empty.
- A disabled tool confirmed genuinely unreachable (no button anywhere), not just visually restyled.
- **Exhaustive completeness check**: every single one of the ~40 keys in `DEFAULT_TOOLBAR_TOOLS` is individually set to `false` (with every provider present, so each key has real content available to remove) and confirmed to produce an actual DOM change versus the fully-enabled baseline - a broad regression net against silently forgetting to wire one of them in a future refactor.

Suite counts after this pass: core untouched (734/734 baseline, no core changes), react 151/151 (was 142, +9 new), `pnpm run lint` clean.

## Related/similar issues

`mobile-more-menu-clipped-and-missing-list-preset.md` (the desktop/mobile duplication gap for one control, fixed the same day - this feature generalizes that same "must apply identically to both surfaces" discipline to every tool). `capability-presets-added.md` (the deeper, schema-level mechanism this composes with).
