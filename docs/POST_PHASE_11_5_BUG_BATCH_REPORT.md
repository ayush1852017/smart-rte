# Post-Phase-11.5 bug batch — completion report

Seven items from manual testing immediately after `docs/PHASE_11_5_COMPLETION_REPORT.md`. All seven reproduced (or, for item 2, genuinely could not be reproduced — reported below rather than assumed), root-caused, and fixed. `docs/bugs/` was checked before starting each item (per `CLAUDE.md`'s standing rule); none had prior entries, so all six are new.

## 1. Real Sootr HTML paste produced `[Unsupported: span]` inside blockquotes

**Root cause:** `packages/core/src/foundation/list/formats.ts`'s HTML parser (`parseBlock`) had no fallback for bare inline content sitting directly inside a `<blockquote>` (no wrapping `<p>`) — every `<span>` run hit the generic "unrecognized tag" fallback and became an `unknown` node. Investigating "is this blockquote-specific" (per the explicit instruction) found a second, larger gap: `<div>`/`<section>`/`<article>` wrapper tags were never handled anywhere in the parser at all — a `<div>`-wrapped `<table>` (extremely common in real exports) was swallowed into one opaque `unknown` node, losing the table's entire structure, not just its text.

**Content-loss vs. formatting-degradation, stated explicitly:** the original HTML text was **not permanently lost** — it survived in the `unknown` node's `attrs.raw.html`, recoverable via re-export. But it was **completely unreadable in the live editor**, and the div-wrapped table's *structure* (real editable cells) was lost outright until fixed. A third, related gap found via the same investigation: `font-weight`/`font-style`/`text-decoration` style attributes were never read as marks at all — confirmed this silently drops real bold text from both this repo's own DOCX import path and real captured Google Docs/native clipboard fixtures, not just this one document.

**Fix:** `formats.ts` gained a `parseBlockList` helper that unwraps transparent containers recursively (applied at root parsing, blockquote, `td`, and `li`), plus blockquote's own direct-inline-content fallback (mirroring `td`/`li`'s existing pattern), plus `font-weight`/`font-style`/`text-decoration` → mark recognition in `textWithMarks`.

**Fixture kept permanently:** `packages/react/e2e/fixtures/test-html-sootr.html`.

**Tests:** `packages/core/src/foundation/list/formats.test.ts` (1 new), `packages/react/e2e/canonical-authority.spec.ts` — "pastes a real Sootr export..." (3 browsers). `packages/core/src/foundation/clipboard/corpus.test.ts` — 2 pre-existing locked structural hashes updated with an explanatory comment, verified as a genuine improvement (inspected each fixture's raw HTML directly), not a blind hash bump.

`docs/bugs/html-import-span-and-div-wrapped-content-lost.md`.

## 2. Context menu didn't close on outside click

**Could not reproduce the reported failure**, despite extensive testing across chromium/firefox/webkit and several realistic scenarios. Stated plainly, per the explicit instruction: click-outside-to-close **was genuinely implemented and functioned correctly** in every attempt — the completion report's claim was accurate, not aspirational.

One real, narrow defect was found while re-verifying: the dismiss listener's effect depended on `onDismiss` (a fresh closure every parent render), causing teardown/reattach churn on every editor state change while the menu was open — a genuine latent race, though never the confirmed cause of the original report (no automated click, always near-instantaneous, ever landed inside that window). Fixed regardless, per the explicit instruction to add the missing coverage "regardless of root cause": the listener now reads `onDismiss` through a ref, mounting exactly once per menu lifetime, plus a `mousedown` fallback alongside `pointerdown`.

**Tests:** "closes the context menu on outside click and on Escape" (new — no such test existed before this batch).

`docs/bugs/context-menu-outside-click-dismiss-untested.md`.

## 3. Context menu showed the same options regardless of target

Two confirmed, distinct causes:

1. **Atoms right-clicked directly** (no preceding left-click — the realistic case) never selected the atom, because atom-selection is `InputController`'s `clickListener`, bound to the native `"click"` event, which never fires for a right-click.
2. **Links right-clicked** got no link-specific items at all (none existed — added "Edit link"/"Remove link" this pass), and separately, a **real, general bug** in `resolveScope.ts`'s `marksForRange` meant a collapsed caret's mark lookup (used by both the toolbar's own Link button and the new context-menu check) only ever found a run at an *exact boundary* — a caret anywhere in a run's interior (the overwhelmingly common case) silently returned no marks. A third issue surfaced writing the regression test: WebKit doesn't reposition the native caret on a bare right-click the way Chromium/Firefox do — fixed with an explicit `caretPositionFromPoint` fallback, guarded to never collapse an existing deliberate selection.

**Tests:** `scope.test.ts` (core, collapsed-caret mark lookup), "scopes context menu items to what was actually right-clicked" (e2e, 4 target types).

`docs/bugs/context-menu-not-scoped-to-click-target.md`.

## 4. Context menu had no scroll and wasn't viewport-responsive

**Root cause:** a hardcoded size estimate (220px/34px-per-item) drove the position clamp instead of the menu's real rendered size — real labels can exceed the estimate, and the clamp only ever slid the menu, never flipped it. No `maxHeight`/scroll at all.

**Fix:** real two-pass measure (render invisibly, measure, position), flipping left/up when the default direction would overflow, plus `maxHeight`/`overflowY: auto`.

**Tests:** viewport-edge and taller-than-viewport tests, all 3 browsers.

`docs/bugs/context-menu-viewport-overflow.md`.

## 5. Right-click near a cell border produced a highlight beyond the table

**Root cause:** `tableMouseDownListener`/`tableMouseUpListener` (native drag-to-select-cells logic) never checked `event.button` — a right-click's own mousedown/mouseup pair reaches the same listeners, and a real hand's natural wobble between press and release is easily enough to land the two events in different cells near a shared border, silently forming a genuine multi-cell selection.

**Fix:** only the primary (left) button starts the drag-selection gesture.

**Tests:** the exact reproduction sequence (no multi-cell selection from right-click), plus a left-click-drag sanity check confirming the legitimate feature still works.

`docs/bugs/right-click-drag-forms-unintended-multi-cell-selection.md`.

## 6. Table resize wasn't smooth/live, and moved unrelated columns

Two confirmed causes:

1. **No live preview** — commit-on-release only; nothing rendered during the drag.
2. **Unrelated columns moving** — the stylesheet's `table { width: 100% }` combined with `table-layout: fixed` makes `<col>` widths *proportions* of the table's rendered width, not literal pixels — growing one column shifted every other column's proportional share. The command layer (`setTableColumnWidthCommand`) was already correct; this was purely a rendering effect.

A third, related defect found reproducing #1: column and row resize handles are both full-length overlays that cross at every boundary intersection; with no z-index difference, whichever rendered later in the DOM won hit-testing, so a column-drag started at the wrong y-coordinate could silently grab a row handle.

**Fix:** the renderer pins the table's own width to the literal sum of `columnWidths`; `TableResizeHandles.tsx` mutates the real `<col>`/`<tr>` directly during the drag (commit-on-release unchanged) and keeps the table's width in sync live too; column handles render after row handles so they win intersection ties.

**Tests:** `tableColumnWidth.test.ts` (core), "previews table column resize live during the drag, and other columns stay independent" (e2e, 3 browsers).

`docs/bugs/table-resize-moves-unrelated-columns.md`.

## 7. Color picker had too few presets

Expanded from 12 to 40 (a grayscale row + 8 hues × 4 shades). The larger grid made the popover tall enough to overflow the same hardcoded-estimate positioning bug as item 4 (found and fixed immediately, before it ever shipped — not filed as a separate ledger entry since it never manifested as a real defect in tested code) — replaced with the same real-measure-then-position pattern. Existing e2e coverage (preset click + custom hex) re-verified passing, unchanged behavior otherwise.

---

## Verification

- **Core:** 602/602 (start of this batch) → **610/610**.
- **React:** 96/96 → **96/96** (unchanged — all new coverage for this batch is e2e or core-level).
- **Full 3-browser e2e (chromium/firefox/webkit, all files, no filter):** 302 passed / 7 skipped / 0 failed (before this batch) → **323 passed / 7 skipped / 0 failed** (final run, all 7 items' fixes and new tests included).
- **`pnpm run lint`:** clean throughout, including the plugin-docs and all phase-contract gates.
- `packages/core` rebuilt before every `packages/react`/e2e run, per this project's stale-dist lesson.

## Process note

Mid-investigation of item 1, `git stash` was used to compare parser behavior before/after a change — since nothing in this multi-phase session had been committed yet, this reverted the *entire* session's uncommitted work, not just the intended one file. Caught immediately and popped back with no work lost. Will not use `git stash` for that kind of before/after comparison again — `git show HEAD:<path>` or direct reasoning about the diff is the safer tool for that.
