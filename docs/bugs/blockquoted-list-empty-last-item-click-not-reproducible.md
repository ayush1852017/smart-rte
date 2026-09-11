# "Can't place cursor in the empty last item of a list inside a blockquote" — not reproducible against current source

**Status:** Not reproducible — reporter also could not reproduce on a second attempt (2026-09-11)
**Area:** list / blockquote / click-to-caret
**First reported:** 2026-09-11, with a screenshot — a numbered list (3 items, last one empty) wrapped in a blockquote; clicking in the empty third item's row appeared to fail ("it's shows below"), with the reporter's own diagnosis that only clicking very close to the list marker/number worked.

## Symptom

Reported: inside a blockquote-wrapped numbered list, clicking anywhere in the empty last item's row except very near the list number either did nothing or moved the caret somewhere else ("below"). Clicking close to the marker worked.

## Investigation

Reproduced the exact structure directly in a real browser (Playwright/Chromium) before asking any follow-up questions: a 3-item numbered list, last item empty, wrapped in a blockquote via the toolbar - tried with **both** plausible interpretations of what items 1/2 actually were (plain paragraphs, and each converted to its own `code_block`, since the screenshot's monospace/boxed styling was ambiguous between "code block" and "a text-selection highlight over a plain paragraph"). Tested clicks at 7 points spanning the full width of the empty last item's row (2% to 98%), at two viewport widths (1400px and 1920px).

**Every click, at every position, in both structural variants, correctly placed the caret in the empty last item.** No failure reproduced.

One real (but unconfirmed-as-the-cause) gap was found along the way: `theme.ts`'s rule that gives an empty block enough height to comfortably click into only targets `<p>` elements -

```css
.srte-editor [contenteditable] p[data-srte-caret-boundary="true"] { min-height: 1.6em; }
```

- and does not match `<pre data-srte-caret-boundary="true">` (an empty `code_block`, which gets the same boundary attribute). In this investigation's own repro, the `pre` element's own padding happened to keep it comfortably clickable regardless, so this did not actually produce a failure here - but it remains a real, narrower gap than the paragraph case, worth fixing on its own merits rather than as a fix for this specific report.

Asked the reporter to retry to help narrow down whether this was Sootr-CSS-specific or environment/timing-related; **they could not reproduce it on a second attempt either**, in the same environment the original screenshot came from.

## Root cause

Not established. Leading candidate, per this project's own documented history: [stale-dist-build-confusion](stale-dist-build-confusion.md) - a stale build or a stale in-memory render state producing a one-off layout/hit-testing glitch that a subsequent interaction or re-render corrected. Not confirmed, since it could not be independently reproduced to test that theory directly.

## Fix

None applied - nothing in current source reproduces the reported symptom. The `p`-only `min-height` selector gap noted above is real but is a separate, smaller finding, not confirmed as this report's cause - worth revisiting if a *code-block-specific* version of this symptom is ever reported.

## Regression coverage

None added - no defect was found to write a regression test against. If this resurfaces, the precise repro steps below are worth trying first before re-investigating from scratch:

1. `?canonicalAuthority=1`, build a numbered list with 2+ items and an empty final item.
2. Select the whole list, click Blockquote.
3. Click at several points across the width of the empty last item's row (not just near the marker) and confirm where the caret actually lands.
4. If it reproduces, capture: is the last item's content a `<p>` or a `<pre>` (code_block)? What's the actual DOM element the click lands on (browser dev tools "inspect" at the click point)? Is this Sootr-only or does the bare playground also show it?

## Related/similar issues

- [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md) and [mixed-depth-select-retype-stray-numbering-not-reproducible](mixed-depth-select-retype-stray-numbering-not-reproducible.md) - the same "thoroughly investigated, never reproduced, both this project's own attempts and the reporter's own retry came back clean" shape, both also attributed (unconfirmed) to [stale-dist-build-confusion](stale-dist-build-confusion.md).
