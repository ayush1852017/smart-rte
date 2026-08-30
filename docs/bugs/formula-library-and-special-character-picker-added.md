# Formula library + special character picker added (was: prompt-based single formula insert, no special-character tool at all)

**Status:** Fixed (feature addition)
**Area:** toolbar / atom / renderer
**First reported:** 2026-08-30 — user-directed scoping request ("Codex prompt — formula library + special character picker: scope and propose"), scope confirmed as "Small" (~55 entries) plus six special-character categories
**Related files:** `color-picker-redesigned-drag-first-no-apply-button.md` (grid/popover pattern reused), `table-insert-hardcoded-2x2-no-size-picker.md` (same "replace a blind prompt/hardcoded action with a real picker" shape)

## Symptom / gap

"Insert formula" was a single `window.prompt("Formula source", "E=mc^2")` — one formula at a time, typed as raw LaTeX from memory, no browsing, no chemistry/physics/stats convenience entries. There was no special-character insertion tool at all (Greek letters, arrows, operators, etc. had to be typed via OS-level input methods or pasted).

## Resolution

Scoped via an artifact proposal (published, indigo/violet palette) presenting formula-library size options (Small/Medium/Large) and a special-character category list; user confirmed **Small** scope and all **six** proposed categories.

Implemented:
- `packages/react/src/formulaLibrary.ts`: 55 entries across 6 domains (algebra 10, geometry 10, calculus 10, physics 12, chemistry 7, statistics 6). Every entry uses `notation: "latex"` — never `"mathml"`, since the renderer has no MathML path (see `formula-mathml-notation-not-rendered.md`, still Open).
- `packages/react/src/specialCharacters.ts`: 203 entries across 6 categories (Greek 48, operators 45, arrows 25, currency 15, punctuation 20, accented Latin 50).
- `packages/react/src/components/FormulaLibraryPopover.tsx` (new): domain tabs + search, live KaTeX preview per entry (`katex.renderToString`, try/catch fallback to raw source on render error).
- `packages/react/src/components/SpecialCharacterPopover.tsx` (new): category sidebar + search, 8-column grid, 8-slot recent row.
- `CanonicalAuthorityEditor.tsx`: "Insert formula" toolbar item now opens `FormulaLibraryPopover` instead of prompting directly; selecting an entry inserts the formula atom then immediately opens the existing edit-atom prompt (`editSelectedAtom()`) pre-filled with the chosen LaTeX, so the existing single-formula-edit flow is reused rather than duplicated. New sibling "Special characters" toolbar item opens `SpecialCharacterPopover`; selecting a character dispatches a synthetic `beforeinput` `InputEvent` (`inputType: "insertText"`) at the surface root, routing through the same `beforeInputListener` → `InputController.replaceSelection` path real typing uses (there is no public "replace selection with text" API on `FoundationEditor` to call directly).
- `katex/contrib/mhchem` registered (chemistry `\ce{...}` notation) via side-effect import in both `packages/core/src/foundation/surface/renderer.ts` (real document rendering) and `FormulaLibraryPopover.tsx` (library's own previews).
- `katex` added as a real `dependencies` entry in `packages/react/package.json` (previously only present in the `keywords` array).

## Root cause (for the lint failure hit along the way)

`check-phase2-5-contract.mjs` flagged the new `insertFormulaFromLibrary` code — a false positive from its naming-convention regex (`positionOf|rangeOf|contentRangeOf` called with a bare local variable named exactly `nodeId`), not a real architecture violation. Fixed by renaming the local to `formulaAtomId` (matching how the pre-existing, lint-clean `onContextMenu` code already avoids the pattern via property access, e.g. `mapped.nodeId`).

## Root cause #2 (real functional bug, found via e2e regression during verification): inserting a block atom right after inserting a formula silently no-opped

Formula is the first UI-reachable **inline** atom (`atomDeclarations`: `{ type: "formula", group: "inline" }` — its parent in the document tree is the paragraph it sits in, unlike `block_image`/`video`/`audio`/`table`, whose parent is always the document root or a table cell). Inserting a formula from the library leaves it selected (`selection.type === "node"`, so the auto-opened edit prompt targets the right atom) — matching the same "select what you just inserted" pattern already used for image/video/audio.

`insertBlockAtom` in `CanonicalAuthorityEditor.tsx` had a `selection.type === "node"` branch that unconditionally treated the *currently selected atom's own parent* as the legal insertion point for the *next* block atom (`parentId = resolved.parent.id`). That's only valid when the selected atom is itself block-level (parent = document root/cell). With a formula selected, that parent is a paragraph — inserting a block atom into a paragraph fails `insertAtom`'s schema validation, so `insertAtom` returns no operations and `insertBlockAtom` returns `false`, silently no-opping (same failure shape as the already-logged `insert-table-while-inside-another-table-silently-no-ops.md`).

Caught by `canonical-toolbar-routing.spec.ts`'s "routes lists, links, tables, atoms, resize, import, and export through retained state" test failing on all three browsers after the formula-library flow was wired in (its own formula-insert step now leaves a formula selected, immediately followed by an "Insert image" step that used to work when formula insertion was a blind `window.prompt` with no lingering atom selection).

**Fix:** `insertBlockAtom` now checks whether the selected atom (via `atomScope()` + its declaration's `group`) is actually block-level before taking the "insert next to the selected atom's parent" branch; otherwise it falls through to the existing generic "insert after the current block" logic (`positions.positionOf` on the resolved node, insert after that block).

**Regression coverage:** new test `canonical-authority.spec.ts` — "inserting an image right after inserting a formula does not silently no-op" (all 3 browsers), plus the fixed `canonical-toolbar-routing.spec.ts` test above.

## Regression coverage

- `packages/react/e2e/canonical-authority.spec.ts`: dedicated formula-library test (search, domain tabs, insert + auto-edit-prompt flow, chemistry/mhchem real-render assertion) and special-character test (collapsed insert, selection-replace, recent row, search). The large "replays generated complete command sessions with semantic selection checkpoints" test's `atom.insert.formula` intent was updated to open the library and click a specific entry (`[data-srte-formula-entry="algebra-quadratic"]`) rather than only opening the popover — it had silently stopped exercising formula insertion once the toolbar button's behaviour changed from direct-prompt to popover-first, even though the suite still reported it as passing (popover-open alone satisfied the intent's own assertions). The page-wide `dialog` handler's existing `"E=mc^2"` fallback answer (originally written for the old prompt-based flow) still applies unchanged, since `editSelectedAtom()`'s prompt is unchanged.
- Confirmed manually in a real browser end-to-end: search/domain-tabs/insert/auto-edit/Escape/outside-click dismiss for the formula popover; collapsed-cursor insert, active-selection replace, recent-row, and search for the special-character popover; chemistry entry renders real KaTeX/MathML markup (not raw-text fallback) in the actual document.
- Full verification after the replay-test fix: core 721/721, react 132/132, `pnpm run lint` clean, full 3-browser Playwright e2e suite green (see completion report for exact counts).

## Related/similar issues

`table-insert-hardcoded-2x2-no-size-picker.md` and `color-picker-redesigned-drag-first-no-apply-button.md` — same shape of replacing a blind/hardcoded single-shot toolbar action with a browsable picker reusing the established popover pattern (outside-click + Escape dismiss, `onMouseDown` preventDefault to avoid stealing editor focus). `formula-mathml-notation-not-rendered.md` — why the library is LaTeX-only.
