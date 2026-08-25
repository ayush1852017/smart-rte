# Does Tab indent a nested list item inside a table cell, or move to the next cell?

**Status:** Not a bug — confirmed working as deliberately designed; the missing piece was regression coverage for this exact combination, now added.
**Area:** input / list / table
**First reported:** 2026-08-21, as a diagnostic question ("is this still open or got fixed as a side effect of one of the four bug rounds") rather than a fresh symptom report.
**Related files:** `packages/core/src/foundation/surface/input.ts` (Tab handler), `packages/react/e2e/canonical-authority.spec.ts`.

## Question

Inside `?canonicalAuthority=1`, put a nested list inside a table cell, place the cursor in the nested item, press Tab: does it indent the list item, or does something table-related happen instead?

## Investigation

Read `input.ts`'s `"Tab"` key handler directly before reproducing anything (the code is explicit about intent, not just implicit behavior to infer from testing):

- Line ~1362: `inTable` is computed from `resolveScope({want:"describe"}).inTable`.
- Line ~1373-1385: `resolveShortcut` tries each registered Tab contribution (list indent/outdent among them) in priority order, but line 1376 explicitly excludes `list.indent`/`list.outdent` whenever `inTable` is true: `if (inTable && (shortcut.commandId === "list.indent" || shortcut.commandId === "list.outdent")) return null;`
- The comment directly above (line ~1370-1372) states the intent in plain language: *"`inTable` short-circuits list contributions specifically: a list nested inside a table cell still yields Tab to the table, exactly as the old chain did."*
- Line ~1405-1409: when nothing else claimed Tab and the caret `inTable`, it calls `handleTableTab(tableId, cellId, shiftKey)` - the existing cell-to-cell navigation feature (Phase 11 Tier 2, already covered by "Tab and Shift+Tab move cell-to-cell in a table...").

So table Tab-navigation is deliberately given priority over list indentation whenever the caret is inside a table cell, regardless of whether a list happens to also be nested at that point. This is not incidental - it's the documented design, present since at least the `tab-key-loses-editor-focus-when-indent-declines.md` fix, which itself scoped its own "Tab always belongs to the list" fix to explicitly exclude table context (that file's fix: "`preventDefault()` now fires unconditionally whenever the cursor is in a list item **and not inside a table**").

Confirmed live (not just via reading) with a real Playwright session: seeded a table cell with a 2-level nested list ("first item" / nested "second item"), placed the caret at the end of the nested item's text, pressed Tab, and inspected the model and selection directly.

- The document was byte-for-byte unchanged after Tab (no indent operation applied, nesting depth unchanged).
- The selection moved from the nested item's paragraph to the paragraph in the *adjacent table cell* - exactly the same cell-to-cell navigation a plain (non-list) cell would produce.
- `document.activeElement` remained the contenteditable root throughout - focus never escaped the editor.

## Root cause

N/A - not a defect. This is deliberate, pre-existing, and unchanged by any of the recent bug-fix rounds (none of the row/column resize, merge, paste-image, or context-menu work touched `input.ts`'s Tab handler or `resolveScope`'s `inTable` reporting).

## Fix

None needed. Added the missing regression test for this specific combination (nested list + table cell + Tab) on the actual product surface, since no existing test fully covered it:
- `"creates a nested list inside a table cell"` (`canonical-toolbar-routing.spec.ts`) only exercises list *creation*, not Tab-key behavior on it.
- `"Tab and Shift+Tab move cell-to-cell in a table..."` (`canonical-authority.spec.ts`) only exercises plain cells with no nested list.
- `"gives table navigation precedence over list Tab"` (`canonical-surface.spec.ts`) is the closest existing test, but runs against the retained/debug `?canonical=1&listTable=1` harness (a minimal reduced schema, `window.__smartCanonical`) rather than the real product authority surface (`?canonicalAuthority=1`, `window.__smartProductCanonical`), and only asserts the document/undo-stack didn't change - it never positively asserts *where* the caret actually landed.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "Tab on a nested list item inside a table cell moves to the next cell instead of indenting": seeds a table cell with a 2-level nested list, presses Tab in the nested item, asserts the document is unchanged, the caret lands in the adjacent cell, and focus never left the editor. 3/3 browsers.

## Related/similar issues

- [tab-key-loses-editor-focus-when-indent-declines](tab-key-loses-editor-focus-when-indent-declines.md) - the fix whose own scoping (list-item-and-not-in-table) is what this investigation confirms is still correctly honored.
- [nested-list-in-table-cell-not-reproducible](nested-list-in-table-cell-not-reproducible.md) - a different question about the same general area (whether a nested list can be *created* inside a table cell at all, not what Tab does to one once it exists).
