# "Insert table" always created a fixed 2×2 — no way to choose dimensions

**Status:** Fixed (2026-08-29) — feature addition, not a defect fix, logged per the standing ledger convention since it changes existing tool behavior broadly enough to break e2e test setup.
**Area:** react / CanonicalAuthorityEditor.tsx, new TableSizePickerPopover.tsx
**First reported:** "Add a row/count selector matching CKEditor's pattern... Wire to the existing table-insert command with the chosen dimensions rather than hardcoding 2×2 downstream."
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`insertTable`), `packages/react/src/components/TableSizePickerPopover.tsx` (new).

## Change

`insertTable()` (`CanonicalAuthorityEditor.tsx`) took no parameters and hardcoded `rows: 2, columns: 2` into `insertTableCommand`. Parameterized to `insertTable(rows = 2, columns = 2)`, sizing `paragraphIds`/`cellIds`/`rowIds` off the chosen dimensions instead of literal `4`/`2`. The toolbar's "Insert table" button now opens a new `TableSizePickerPopover` (CKEditor's own pattern: an 8×8 hover grid that live-labels "R × C table" and inserts immediately on a cell click - a single click is already a complete, deliberate choice, the same reasoning `ColorPickerPopover`'s recent-swatch buttons use) plus a numeric rows/columns fallback with its own Insert button for sizes past the grid's cap.

## Bugs found and fixed while building this

- **Escape didn't dismiss the new popover.** Nothing inside it is autofocused on open (the grid is meant to be hovered, not tabbed into), so keyboard focus stays on whatever triggered it (the toolbar button), never reaching the popover's own `onKeyDown`. Fixed with a `window`-level `keydown` listener for Escape - the same fix just applied to `LinkEditorPopover` for the identical reason (`docs/bugs/link-overlay-autofocus-steals-editor-focus-on-plain-click.md`).

## Pre-existing gap found, not fixed (out of scope)

Discovered while verifying: invoking "Insert table" a second time while the caret is already inside another table's cell silently does nothing (no second table, no error) - confirmed unrelated to this change (identical for every size, including the previously-only-available fixed 2×2). Logged separately: `docs/bugs/insert-table-while-inside-another-table-silently-no-ops.md`.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` - new: "insert table size picker: grid hover-click and custom numeric input both wire real dimensions through" - hover-and-click a grid cell inserts the exact hovered size, Escape and outside-click both cancel without inserting, and the numeric rows/columns inputs reach a size (9×10) past the grid's 8×8 cap. Every pre-existing test that used "Insert table" as setup (22 call sites across `canonical-authority.spec.ts` and `canonical-toolbar-routing.spec.ts`) updated to a new shared `insertDefaultTable(page)` helper (`e2e/toolbarHelpers.ts`) that clicks through the picker's 2×2 grid cell - reproduces the exact old default behavior, not a scope change to what those tests were actually verifying. Full `canonical-authority.spec.ts` (103/103) and `canonical-toolbar-routing.spec.ts` (14/14, now 15 with the new test) re-run clean.

## Related/similar issues

[insert-table-while-inside-another-table-silently-no-ops](insert-table-while-inside-another-table-silently-no-ops.md) - the pre-existing gap found during verification, not fixed here.
[link-overlay-autofocus-steals-editor-focus-on-plain-click](link-overlay-autofocus-steals-editor-focus-on-plain-click.md) - the same "nothing autofocused, Escape needs a window-level listener" fix, applied here for the same reason.
