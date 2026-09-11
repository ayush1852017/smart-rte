# Mark toolbar tools (Bold, Italic, Link, ...) stayed clickable but did nothing wherever marks are disallowed

**Status:** Fixed
**Area:** react - `CanonicalAuthorityEditor.tsx`
**First reported:** 2026-09-11 — a follow-up design discussion, not a live bug report: "So based on those marks should we conditionally disable not allowed tools to make it clear in the first place for users?"

## Symptom

`code_block` (and every atom - image, video, formula, divider, page break) declares `marks: ""` in its schema spec, meaning no mark can attach to text inside it. The command layer already handled this correctly and silently - `applyMarkCommand` simply skips any selected range whose owner disallows the mark, producing zero operations rather than an error. But the toolbar never surfaced that: Bold, Italic, Underline, Strikethrough, Code, Superscript, Subscript, Text colour, Background colour, Font size, Font family, and Link were all only ever gated on `readOnly` - fully clickable, with a click inside a code block (or with an atom selected) doing precisely nothing and giving no indication why.

## Fix

Added `markToolAllowed(id)` in `CanonicalAuthorityEditor.tsx`, wired into all 12 mark tools' `disabled` prop (in every place each one renders - main toolbar, the "More text styles" dropdown, and their `widePromote` copies; the mobile more-menu reuses the same JSX object so it inherited the fix automatically).

The implementation deliberately reuses `reportMarkApplication` (`packages/core/src/foundation/marks/commands.ts`) rather than writing new detection logic - this function already existed for exactly this question and already had its own core-level test coverage (`marks.test.ts`, `block/input.test.ts`), but was previously referenced only from tests, never wired into any UI. It reports `ownerCount` (how many distinct blocks the current selection/caret touches) and `ownerIdsSkipped` (how many of those disallow the mark); a tool is enabled whenever `ownerCount > ownerIdsSkipped.length` - i.e., **at least one** touched block would actually accept the mark.

This "at least one," not "every one," choice is deliberate: a selection spanning both a normal paragraph and a code block already applies the mark to the paragraph half only (silently skipping the code block half) - that's existing, correct partial-apply behavior. Disabling the button the moment *any* touched block disallows the mark would have removed that capability for no reason. The button now stays enabled for that mixed case and only disables when literally nothing in the current selection would accept the mark - a collapsed caret inside a code block, a fully-inside-a-code-block selection, or an atom node selection (which has no inline range at all, so `ownerCount` is `0`).

## Regression coverage

New test in `e2e/canonical-authority.spec.ts`, "mark toolbar tools disable inside a code block (which allows no marks) and re-enable back in a normal paragraph": confirms Bold/Italic/Link are enabled in a normal paragraph, disabled once the block is converted to code_block via the Block type dropdown, and re-enabled once converted back. Confirmed the test genuinely fails without the fix (temporarily reverted `CanonicalAuthorityEditor.tsx` via `git stash`, reran, got a real failure - `toBeDisabled()` found the button still enabled - then restored and confirmed it passes). Passed 3/3 browsers.

Full suites: react unit 151/151, typecheck clean.

## Related/similar issues

- The "notable gap" flagged during the exploratory research that led to this fix (see the conversation, not a separate bug file) - `reportMarkApplication` existing but unwired was noted at the time as worth fixing; this is that fix.
