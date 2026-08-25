# Shift+Home / Shift+End collapsed the selection instead of extending it

**Status:** Fixed
**Area:** core / surface input / keyboard handling
**First reported:** 2026-08-20, as "block up and down is working fine unless I select whole line and then do block up and down" - traced to this, not a bug in block move itself.
**Related files:** `packages/core/src/foundation/surface/input.ts`.

## Symptom

Selecting a whole line via keyboard (click into the line, Home, then Shift+End) and pressing "Block ↑"/"Block ↓" repeatedly produced order and selection state that looked wrong compared to a single, correctly-scoped block move.

## Reproduction

Traced directly, not assumed: `handleKeyDown`'s `"Home"`/`"End"` branch built `{ anchor: next, head: next }` - a **collapsed** selection - unconditionally, regardless of `event.shiftKey`. Confirmed via `editor.selection` before/after a `Shift+End` press: pressing it after `Home` (which correctly placed a collapsed caret at offset 0) produced `{anchor: 20, head: 20}` instead of `{anchor: 0, head: 20}` - the existing anchor was discarded and both endpoints jumped to the line end, exactly like a bare `End` press. Shift+Home/End - the standard "select to line start/end" keyboard gesture - could never actually select anything.

Once this was fixed and re-tested, the originally-reported "Block ↑ acts weird" sequence did **not** reproduce - a properly-extended selection moved correctly and predictably through repeated presses, matching a plain, already-correct single-block swap. The block-move mechanism itself was never the problem; it was never being given a real selection to work with.

## Root cause

A straightforward missing modifier check - the Home/End handler was written to always collapse, with no branch for the Shift-extend case at all.

## Fix

`anchor` is now `event.shiftKey ? this.editor.selection.anchor : next` - preserving the existing anchor (extending) when Shift is held, collapsing to the new position (the pre-existing, correct behavior) otherwise.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`:
- "Shift+Home and Shift+End actually extend the selection instead of collapsing it" - asserts Shift+Home moves only `head` to the line start (keeping the prior anchor, producing a real non-collapsed range), Shift+End extends from that same anchor to the line end, and a bare (non-Shift) Home/End still collapses as before.
- "selecting a whole line with Home/Shift+End then repeated Block up moves it correctly" - the exact reported repro shape: select a whole line via Home+Shift+End, press "Block ↑" twice, asserting the selection stays a real range following the moved block's identity and the resulting order matches a correct single-block-swap sequence at every step.

## Related/similar issues

[block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) - a different, already-fixed defect in the same general area (block move + selection tracking); ruled out as the cause here via direct investigation (five separate reproduction attempts logged in `docs/POST_PHASE_11_5_BUG_BATCH_2_REPORT.md` item 7 before this was found) before concluding the real cause was upstream, in how the selection was constructed in the first place, not in how block move preserves it.
