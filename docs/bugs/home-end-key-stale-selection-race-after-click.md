# Home/End read a stale selection right after a real click, silently committing the wrong caret position

**Status:** Fixed (2026-08-29)
**Area:** core / surface/input.ts (`handleKeyDown`)
**First reported:** as "code block inside a blockquote: no reachable position below it, Enter kicks the cursor outside the blockquote entirely" — investigated as a suspected blockquote-boundary bug (see [code-block-in-blockquote-enter-handling-not-a-bug](code-block-in-blockquote-enter-handling-not-a-bug.md), whose own conclusion this supersedes) but turned out to be a real, unrelated stale-selection race that just happened to be reproduced via that shape.
**Related files:** `packages/core/src/foundation/surface/input.ts` (`handleKeyDown`, `syncSelectionFromDom`).

## Symptom

Click into a code block nested inside a blockquote, press End, then Enter: instead of a literal newline inside the code block, a whole new paragraph appeared **before the blockquote**, as if the cursor had exited the blockquote entirely.

## Reproduction

A real Playwright click (not the programmatic `setSelection` the pre-existing "not a bug" investigation used) into `<pre>` content, followed by `End` then `Enter` then typing, reproduced the bug in **9 of 10** runs — a race, not a deterministic defect, which is exactly why the earlier `setSelection`-based investigation never saw it: that investigation's caret placement bypassed the native click path entirely, so it could never exercise the race.

Instrumented with a global `selectionchange`/`MutationObserver` listener to capture the real event sequence: after the click, `selectionchange` for the click itself hadn't fired yet (delivered asynchronously in Chromium, exactly as `handleKeyDown`'s own pre-existing comment already documents for Ctrl/Cmd+A) when `End`'s `keydown` handler ran. `End`'s handler read `this.editor.selection.head` directly — still the *previous* (stale) selection, e.g. the very start of the document — computed "end of that stale owner" (the document's first paragraph, 24 characters), and **explicitly called `setSelection` + `render()` on that wrong position**, physically moving the real native caret out of the code block and off to the end of the first paragraph. `Enter` then genuinely operated on that now-consistently-wrong (both model and native) position, correctly falling through to the generic block-split path from its own perspective - it never saw a code block at all, because by the time it ran, the caret genuinely wasn't in one anymore.

## Root cause

`handleKeyDown`'s existing defensive resync (`if (!this.composition && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)) this.syncSelectionFromDom();`) was scoped to arrow keys only. `Home`/`End`'s own handler reads `this.editor.selection.head` synchronously with no equivalent resync, so it inherited the exact same class of race the arrow-key fix exists to prevent - just never extended to it. `Enter`'s modifier branches (Ctrl/Cmd+Enter's `exitCodeBlock`, Shift+Enter's `insertLineBreak`) read `this.editor.selection.head` synchronously in `handleKeyDown` too, before the plain-Enter path's own `beforeinput`-time resync (`surface/input.ts` line ~1284) would ever run - same exposure, different branch.

Nesting inside a blockquote was never actually load-bearing: any code block (or any owner at all) immediately after a real click is equally exposed to this race on End/Home. The blockquote-nested-code-block shape only mattered because that's the exact repro the report used.

## Fix

Extended the existing resync condition's key list from `["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]` to also include `"Home"`, `"End"`, and `"Enter"` - the same generalized mechanism the arrow-key case already established, not a new one-off patch. `Enter` is included because its own modifier branches read selection before the plain-Enter path's later resync would run.

## Regression coverage

`packages/core/src/foundation/marks/marks.test.ts` is unrelated (separate fix, same batch); this fix's own coverage:
- `packages/react/e2e/canonical-authority.spec.ts` - new: "a real click into a code block nested in a blockquote, then End, then Enter, inserts a literal newline and stays inside" - a real Playwright click (not programmatic `setSelection`) into the code block, `End`, `Enter`, then typing; asserts the code block's text is exactly `"line one\nline two"` and exactly one blockquote still exists. Run 15 times in isolation during investigation with 0 failures post-fix (was ~90-100% reproducible pre-fix depending on exact timing/instrumentation overhead).
- Full core suite (721/721) and the relevant Home/End/code-block e2e subset re-run clean after the change - see the batch completion report for full counts.

## Related/similar issues

[code-block-in-blockquote-enter-handling-not-a-bug](code-block-in-blockquote-enter-handling-not-a-bug.md) - the original "no defect found" investigation this supersedes; its own conclusion (no blockquote-specific boundary bug) is still correct as far as it went, it just never exercised a real click and so never hit this unrelated race.
