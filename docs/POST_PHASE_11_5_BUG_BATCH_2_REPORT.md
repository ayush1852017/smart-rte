# Post-Phase-11.5 bug batch, round 2 — completion report

Seven more items from a second round of manual testing, immediately after `docs/POST_PHASE_11_5_BUG_BATCH_REPORT.md`. Six fixed/built; one (block move selection tracking) could not be reproduced despite extensive effort — reported honestly below rather than claimed fixed. `docs/bugs/` was checked before each item; none had prior entries.

## 1. Every resize handle highlighted blue during a single drag

**Root cause:** `TableResizeHandles.tsx`'s highlight condition checked only `dragging?.kind`, never which specific boundary index was being dragged - every handle of the same kind (all rows, or all columns) lit up together.

**Fix:** `dragging` state now includes `index`; both highlight conditions compare it.

`docs/bugs/table-resize-handles-all-highlight-together.md`.

## 2. Table shrank after paste

**Root cause:** a `<col>` with no real pixel width data (empty, a percentage, or a non-pixel CSS unit like Excel's `pt`) got an arbitrary 120px-per-column fallback during HTML import. Once the previous batch's fix started pinning a table's own rendered width to the literal sum of `columnWidths`, that fabricated small default became the table's real, visible size instead of being invisibly overridden by the stylesheet's `width: 100%`.

**Fix:** column-width parsing is now all-or-nothing - `columnWidths` is only set when every `<col>` has a genuine, parseable pixel width (a bare number or explicit `"Npx"`, never a percentage or other unit misread as pixels); otherwise the table falls back to its natural stretched rendering exactly as before. Also fixed a real, related bug found in the same code: Excel's `<col>`s carry both a real pixel `width` attribute and a **points**-valued `style="width:...pt"` - the old code checked style first and silently misread points as pixels (a ~25% understatement even when real data existed).

`docs/bugs/table-shrinks-after-paste.md`.

## 3. Media gets its own context menu

Added "Edit media" / "Resize +" / "Resize −" to the atom context menu, alongside the existing "Delete" - reusing the exact same `editSelectedAtom` the toolbar's own media buttons already call, no new command-layer or dialog logic.

## 4 & 5. Context menu had every text-style option, table cells had none

Per your decision: trimmed the context menu's mark list to Bold/Italic/Underline/Clear formatting (Strikethrough/Code/Superscript/Subscript stay on the toolbar, not duplicated in the menu). Added real cell-style options - "Cell background colour" and "Cell text colour" - to the table context menu, reusing the same `ColorPickerPopover` the toolbar's own color buttons use, applied via the existing `table.setCellAttributes` command.

**A real bug found building this:** `table_cell.attrs.textColor` was already a parseable, settable attribute end to end (HTML import, `table.setCellAttributes`) but the renderer never applied it to the DOM at all - the identical "written, never rendered" shape `columnWidths` had before it. Fixed alongside the new feature; would otherwise have shipped a color picker that visibly did nothing.

`docs/bugs/table-cell-text-color-not-rendered.md`.

## 6. Real color picker instead of a list of colors

Added a native `<input type="color">` to `ColorPickerPopover.tsx`, alongside (not replacing) the existing preset swatches and hex input - the swatches stay useful for one-click access to common colors; the native picker covers everything else with a real visual UI instead of typing hex codes.

## 7. Block move up/down corrupts selection on repeated use — could not reproduce

**Reported behavior:** select the last of 3 paragraphs, press "Block ↑" repeatedly; the first move is described as correct but the selection then grows to cover two blocks, and further presses produce increasingly scrambled ordering.

**What was tried, none of which reproduced anything wrong:**
- A collapsed-then-extended full-paragraph selection (`Range.selectNodeContents`), 3 repeated moves.
- A real triple-click (native browser "select paragraph"), 3 repeated moves.
- A selection deliberately constructed to span two adjacent blocks, to test whether a multi-block group move behaves correctly (it does - the whole group moves and stays together).
- A real mouse click-and-drag selection across the visible text, 2 repeated moves.
- Keyboard `Home` / `Shift+End` selection (this surfaced a separate, minor finding: `Home` in this editor doesn't reliably move to the start of the clicked line - worth a look, not investigated further here since it didn't reproduce the reported symptom either).

In every case, `editor.selection` and the native DOM selection stayed correctly anchored to the moved block's own identity through repeated moves, and the resulting order matched what a correct single-block swap-with-predecessor should produce. `packages/react/src/canonicalEditorRuntime.ts`'s `preserveSelectionById` mechanism (the code this bug would live in) re-derives the selection from the pre-move owner node's *identity*, not its old path, specifically to survive exactly this kind of reorder - and it did, in every variant tried.

**This is being reported as "could not reproduce," not "fixed" or "not a bug."** If you can share the exact steps again - ideally a short screen recording, or answers to: was the selection made with the mouse or keyboard, is the browser Chrome/Firefox/Safari, and does the document have anything else nearby (a table, a heading) besides the 3 paragraphs - that would let this be pinned down properly rather than left as a guess.

---

## Verification

- **Core:** 611/611 (start of this round) → **612/612**.
- **React:** 96/96 → **96/96** (unchanged; new coverage for this round is core-level and e2e).
- **Full 3-browser e2e (chromium/firefox/webkit, all files, no filter):** 323 passed / 7 skipped / 0 failed (before this round) → **341 passed / 7 skipped / 0 failed** (final run, all 6 fixes/features and their new tests included).
- **`pnpm run lint`:** clean.
- `packages/core` rebuilt before every `packages/react`/e2e run.
