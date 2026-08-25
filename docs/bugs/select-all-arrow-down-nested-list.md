# Select-all + ArrowDown/ArrowUp doesn't reach the true document end/start once a list exists

**Status:** Fixed
**Area:** selection / input / renderer / list
**First reported:** 2026-08-20, as "select-all + Down arrow doesn't reach document end with nested-list content"
**Related files:** `docs/bugs/select-all-delete-fails-on-structural-documents.md` (same general family: whole-document-selection edge cases going through a code path that assumes plain content), `docs/bugs/shift-home-end-does-not-extend-selection.md` (a prior, unrelated bug in the same neighborhood of keyboard selection handling, checked and ruled out as a shared cause).

## Symptom

Type a few plain lines, create a list below them with at least one nested (indented) item, press Ctrl/Cmd+A then ArrowDown: the cursor lands only a couple of lines from the top instead of the true document end. The identical sequence worked correctly on plain content. Reported ArrowUp (select-all then Up, expecting document start) as worth checking under the same conditions but not itself reported broken.

## Reproduction

Reproduced directly via real typing + real native Ctrl/Cmd+A + real ArrowDown in Playwright against Chromium, Firefox, and WebKit — not assumed from the report. Two things were checked in detail before concluding:

- **Model-injected whole-document selections** (document built via `replaceValue`, selection set directly to `{path: [], offset: 0}`–`{path: [], offset: N}`, then a real Ctrl/Cmd+A + ArrowDown/ArrowUp): this shape passed in Chromium and WebKit for plain content, a flat list, and a nested list, both before and after the `input.ts` fix below — meaning that specific mechanism was *not* the actual trigger for the reported symptom in those two engines. It *did* fail in Firefox, but only on ArrowUp, and identically for all three content shapes (not list-specific) — a real, separate, previously-unknown bug in its own right, fixed by the same change.
- **Real typing + real UI list creation + Tab to nest** (the literal reported repro): this failed in Chromium and WebKit exactly as reported. Bisection (typing only → + list, no indent → + list + Tab indent → + list + Tab indent + typing) showed the break happens the moment *any* list item exists — nesting is not the distinguishing factor, a flat single-item list already breaks it. Direct inspection of `window.getSelection()` immediately after Ctrl/Cmd+A showed `isCollapsed: true`, i.e. **native select-all was selecting nothing at all**, not merely collapsing a real selection to the wrong place. Confirmed by temporarily removing a specific DOM element (see Root cause) before pressing Ctrl/Cmd+A, which immediately restored correct native select-all behavior.

## Root cause

Two independent, stacked bugs, both real, both fixed:

1. **`packages/core/src/foundation/surface/input.ts`'s ArrowUp/ArrowDown handler had no case for a non-collapsed `type: "text"` selection at all** — only `selection.type === "node"` was intercepted (with its own `preventDefault()` + `moveCaret` call). A `type: "text"`, non-collapsed selection (exactly what Ctrl/Cmd+A produces) fell through with no `preventDefault()`, leaving the collapse entirely to native vertical-arrow behavior — unlike ArrowLeft/ArrowRight, which already explicitly collapse any non-collapsed text selection to a deterministic, normalized endpoint (see `docs/bugs/arrow-key-collapse-ignores-direction.md`, an earlier bug in that same explicit-collapse logic). This is confirmed unreliable independent of list content: Firefox's native ArrowUp-after-select-all collapses to the wrong position even for plain paragraphs.
2. **The actual proximate cause of the specific reported Chromium/WebKit symptom is one layer upstream of (1): native Ctrl/Cmd+A itself silently selects nothing.** `packages/core/src/foundation/surface/renderer.ts`'s `announceSelectedLevel` appends a visually-hidden, `contenteditable="false"` ARIA live-region element (`data-smart-ui="list-level-announcement"`) as a **child of the contenteditable root itself**, the first time any list item's depth changes — which happens the moment a list is first created (going from "no list" to depth 0 is itself a depth change), not only on actual nesting. A `contenteditable="false"` island living inside a `contenteditable="true"` root is a known trigger for native select-all misbehavior in Chromium and WebKit (shared Blink/WebKit engine ancestry); Firefox, an independent implementation, is unaffected — matching the observed cross-engine split exactly. With no real native selection ever produced, fix (1) has nothing to act on: `collapsed(this.editor.selection)` is true, so the new explicit-collapse branch never triggers, and the browser's own (broken) default action runs instead.

## Fix

- `packages/core/src/foundation/surface/input.ts`: the ArrowUp/ArrowDown handler gained a second branch (alongside the existing `type === "node"` case) that explicitly collapses a non-collapsed `type: "text"` selection to the true first/last editable position when — and only when — it is a genuine whole-document range (`isWholeDocumentRange`, the same helper `select-all-delete-fails-on-structural-documents` already uses). The target position is computed via `editableOwners`, the same document-order, structural-container-transparent walk `moveCaret` already uses for cross-container navigation, so it is correct regardless of what the leading/trailing content is (plain, flat list, or arbitrarily nested list). Ordinary, non-whole-document vertical arrow movement is deliberately left native, unchanged — real line-based caret movement isn't something the model layer can or should replicate.
- `packages/core/src/foundation/surface/renderer.ts`: `announceSelectedLevel` now appends its live-region element to `this.root.parentElement` (falling back to `this.root` only if no parent exists) instead of `this.root` itself. The announcement has no accessibility reason to be physically nested under the editable content — an `aria-live` region only needs to be present in the document to be announced correctly.
- `packages/core/src/foundation/list/browserInput.test.ts`: updated to query the live region from `document.body` instead of the (now no longer containing it) `root`, matching its new, correct location.

## Regression coverage

- `packages/core/src/foundation/phase2_5.test.ts`: `"collapses a whole-document (select-all) selection to the true document end/start with ArrowDown/ArrowUp, regardless of trailing structural content"` — jsdom-level, guards fix (1) directly across plain content, a flat list, and a nested list; confirmed to fail without the fix (including for the plain-content control, since jsdom's own native ArrowDown fallback is unreliable too).
- `packages/react/e2e/canonical-authority.spec.ts`:
  - `"select-all + ArrowDown/ArrowUp collapses to the true document end/start with ${shape}"` (parameterized: plain content / flat list / nested list) — model-injected whole-document selection, real native Ctrl/Cmd+A + arrow keys, guards fix (1) in isolation.
  - `"reproduces via real typing: select-all + ArrowDown reaches the true end after creating and nesting a list"` — the literal reported repro end to end (type, create list, Tab to nest, select-all, arrow down/up), guards both fixes together; this is the one that actually depends on fix (2), since without it Ctrl/Cmd+A never produces a real selection for fix (1) to act on.
  - `"reproduces via real typing: creating even a flat, non-nested list breaks native select-all in Chromium/WebKit"` — confirms nesting depth specifically does not matter, any list does.
  - `"keeps the list-level-announcement live region outside the contenteditable root"` — direct, fast check on fix (2)'s DOM placement, independent of native select-all behavior.
- Full 3-browser e2e suite (chromium/firefox/webkit, all files, no filter) run clean after both fixes (see completion report for counts). Core suite: 614/614.

## Related/similar issues

- [select-all-delete-fails-on-structural-documents](select-all-delete-fails-on-structural-documents.md) — same general family (a whole-document-selection edge case breaking specifically for structural content), different code path (deletion, not arrow-key collapse) and a different specific bug, but the `isWholeDocumentRange`/`isDocumentEnd`/`isDocumentStart` machinery that bug's fix built is reused directly by fix (1) here.
- [arrow-key-collapse-ignores-direction](arrow-key-collapse-ignores-direction.md) — the precedent for ArrowLeft/ArrowRight's existing explicit, deterministic text-selection collapse; ArrowUp/ArrowDown never had the equivalent case at all until fix (1).
- [shift-home-end-does-not-extend-selection](shift-home-end-does-not-extend-selection.md) — checked directly as a candidate shared-code-path cause per the work order's explicit instruction; ruled out — it's a completely separate branch (`Home`/`End`, not `ArrowUp`/`ArrowDown`) with no shared logic.
- [nested-list-in-table-cell-not-reproducible](nested-list-in-table-cell-not-reproducible.md) — a different, unrelated nested-list report (list *creation* inside a table cell, not select-all/arrow collapse); noted only because both involve "nested list" in the title, ruled out as related on inspection.
