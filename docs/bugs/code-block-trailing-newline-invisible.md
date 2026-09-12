# A single Enter at the end of a code block's content looked like it did nothing

**Status:** Fixed
**Area:** core - `foundation/surface/renderer.ts`
**First reported:** 2026-09-12, live report — "but single enter not adding new line."
**Related files:** [empty-line-caret-not-visible-after-enter](empty-line-caret-not-visible-after-enter.md) — the closest precedent (a renderer-only `<br>` projected for a browser line box the model doesn't need), but for a *fully empty* paragraph/heading/code block, not this case. [code-block-list-item-cannot-exit-to-new-sibling-item](code-block-list-item-cannot-exit-to-new-sibling-item.md) — the same-day investigation this surfaced from; that fix (and its own follow-up) are correct and unrelated to this rendering gap.

## Symptom

Typing in a code block and pressing Enter once (to add a blank line before typing more, or before the "type, Enter, Enter" rhythm used to exit the block into a new list item) appeared to do nothing — no visible new line, no visible caret drop.

## Investigation

A code block stores line breaks as literal `"\n"` characters inside its text content (`insertCodeBlockNewline` in `block/input.ts` does a plain `insertText` of `"\n"`), unlike a paragraph, which represents a line break as an explicit `hard_break` node. A screenshot-and-document-dump trace (done while investigating a related list bug the same day) confirmed the model genuinely gained the `"\n"` character and the DOM's text node genuinely contained it — but the `<pre>` element's `getBoundingClientRect().height` was identical before and after. Under `white-space: pre-wrap`, a trailing `"\n"` with nothing rendered after it does not get its own line box — there's no following content for the browser to anchor a new line against, the same category of gap the empty-line fix above solved for a *completely* empty owner, but that fix's `needsProjection` check only fires at `children.length === 0`, which a code block with real preceding text never satisfies.

## Fix

`renderer.ts` adds a second, parallel renderer-only projection (`syncTrailingNewlineProjection`, `data-smart-trailing-newline`): whenever a code block's last text child ends in `"\n"`, a `<br>` is appended after the real text content to force the browser to actually draw that last, otherwise-invisible line. It is added/removed on both full render (`createNode`) and diff-update (`diffElement`, after real children are already synced — appending it earlier would insert it before the text it's supposed to follow), and — like the empty-line marker — is UI-only and never enters the canonical model. Scoped strictly to `code_block`; a paragraph with a literal `"\n"` character in its text (not idiomatic, but schema-legal) is deliberately left untouched, since paragraphs don't use this newline-as-content-character representation for line breaks in the first place.

## Regression coverage

`packages/core/src/foundation/surface/renderer.trailingNewline.test.ts` (new, jsdom environment): projects on first render; does not project without a trailing newline; adds/removes correctly across diff-updates as text changes; never fires for a paragraph. Confirmed to fail without the fix via `git stash` (2 of 4 — the negative-case tests trivially pass either way).

`packages/react/e2e/canonical-authority.spec.ts`: "pressing Enter once at the end of a code block's content grows the visible box, even though it stays in the code block" — measures real `getBoundingClientRect().height` before/after a single Enter in a live browser. Confirmed to fail without the fix (no height change) via `git stash` + rebuild. Passed 3/3 browsers.

Full suites: core 760/760 (+4), react 151/151, full three-browser `canonical-authority.spec.ts` suite (130 tests, chromium) green, typecheck and lint clean.
