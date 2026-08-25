# Post-Phase-11.5 bug batch, round 3 — completion report

Four more items, immediately following round 2. All four reproduced, root-caused, and fixed - including one (item 3) that turned out to be a real bug in keyboard selection handling, not in block move itself, found only after five earlier reproduction attempts across two rounds had failed. `docs/bugs/` was checked before each item; none had prior entries.

## 1. Table shrinks again as soon as you drag-resize any column, even a little

**Root cause:** a follow-on effect of round 2's fix for "table shrinks after paste." A table with no `columnWidths` yet (the correct, natural-width state that fix produces) has no real per-column data for `setTableColumnWidthCommand` to work from - its own fallback for that case, `Array(columns).fill(120)`, ran on *every* resize of such a table, silently resetting every column *other* than the one being dragged to a fabricated 120px. Since the renderer pins the table's own width to the literal sum of `columnWidths`, that sum was now dominated by fake 120px entries the instant any single column was resized.

**Fix:** `setTableColumnWidthCommand` gained an optional `widths` param that seeds the *real* current values instead of guessing; `TableResizeHandles.tsx` (which already measures every column's real rendered width for handle positioning) now passes that measurement through on release.

`docs/bugs/table-resize-shrinks-table-with-no-prior-columnwidths.md`.

## 2. Color picker: remove the swatch list, keep only the picker — and it closed the instant you touched it

Removed the 40-swatch preset grid entirely, per your instruction - the native `<input type="color">` (added last round) plus the hex text input are now the only ways to choose a color.

**A real bug found in the process:** the native color input's `onChange` was wired directly to `apply()`, which closes the whole popover. Some browsers fire that event on the very first interaction with the native picker - not only on a final, deliberate choice - so the popover closed itself before you could actually pick anything. Fixed: the native input now only stages the value (same as the hex input already did); the explicit "Apply" button is the one thing that commits and closes it.

`docs/bugs/color-popover-closes-on-first-native-picker-interaction.md`.

## 3. Block up/down "acts weird" specifically after selecting a whole line

This took two full rounds of reproduction attempts to actually catch. The block-move mechanism itself was correct in every test - the real bug was one step earlier: **Shift+Home and Shift+End never actually selected anything.** `surface/input.ts`'s Home/End key handler built a collapsed selection unconditionally, completely ignoring the Shift key - pressing Shift+End after Home moved *both* the anchor and the caret to the line's end, discarding whatever had been selected, identical to a bare End press. Since "select the whole line" (Home, then Shift+End) never produced a real selection, "Block ↑"/"Block ↓" was never operating on the scope you intended - not because block move was broken, but because there was nothing real to move yet.

**Fixed:** Shift+Home/End now correctly extend the selection (keep the existing anchor, move only the caret end) instead of collapsing it. Re-tested the exact originally-reported sequence (select whole line, "Block ↑" twice) with the fix in place - it now behaves correctly and predictably at every step.

`docs/bugs/shift-home-end-does-not-extend-selection.md`.

## 4. Context menu needs scroll with a fixed height

The scroll behavior from round 1 was real, but its `maxHeight` scaled with how much viewport space happened to remain below the click point - inconsistent, and with the extra items added last round (cell colour, media edit/resize), a click with room to spare could show 15+ items with no scroll at all. Added a fixed 400px cap (still further clamped down, never up, on a genuinely short viewport) - the scroll threshold is now the same everywhere, not dependent on where you clicked.

`docs/bugs/context-menu-height-not-fixed.md`.

---

## Verification

- **Core:** 612/612 (start of this round) → **613/613**.
- **React:** 96/96 → **96/96** (unchanged; new coverage is core-level and e2e).
- **Full 3-browser e2e (chromium/firefox/webkit, all files, no filter):** 341 passed / 7 skipped / 0 failed (before this round) → **350 passed / 7 skipped / 0 failed** (final run, all 4 fixes and their new tests included).
- **`pnpm run lint`:** clean.
- `packages/core` rebuilt before every `packages/react`/e2e run.
