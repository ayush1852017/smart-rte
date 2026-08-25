# Context menu's "click-outside-to-close" had no regression test and a latent listener-churn race

**Status:** Fixed
**Area:** react / ContextMenu.tsx / event handling
**First reported:** 2026-08-19, post-Phase-11.5 manual testing ("context menu does not close on outside click, contradicting the completion report's §A claim").
**Related files:** `docs/PHASE_11_5_COMPLETION_REPORT.md` §A (the claim in question).

## Symptom

Manual testing reported that right-clicking to open the context menu, then clicking elsewhere, did not close it — contradicting `docs/PHASE_11_5_COMPLETION_REPORT.md`'s description of `ContextMenu.tsx` as "keyboard-dismissible, click-outside-to-close."

## Reproduction

**Could not reproduce the reported failure directly.** Extensive testing across chromium/firefox/webkit: right-click then click elsewhere in the editor, right-click then click a toolbar button, right-click near the viewport's right edge (where the menu's own bounds are more likely to overlap a naive "click at a fixed offset"), repeated open→Escape→reopen and open→select-item→reopen cycles — every scenario tried closed the menu correctly on an outside click.

## Root cause — stated plainly, per the standing instruction to distinguish "broken" from "never implemented"

**Click-outside-to-close was genuinely implemented** (`ContextMenu.tsx`'s `useEffect` registering a capture-phase `window` `pointerdown` listener that calls `onDismiss()` when the event target is outside the menu's DOM subtree) **and functioned correctly in every reproduction attempt** — the completion report's claim was accurate to the code's actual behavior, not aspirational or unverified-but-wrong.

That said, one real, if narrow, defect was found while re-verifying: the listener effect's dependency array was `[onDismiss]`, and `onDismiss` is a fresh closure on every render of `CanonicalAuthorityEditor` (`() => { setContextMenu(null); runtime.focus(); }`), which itself re-renders on every `runtime.editor.subscribe` tick — i.e. on every document or selection change, which can happen while the menu is still open (e.g. if the triggering right-click's native mousedown also moved the caret). Each such re-render tore down and reattached the `window` listener. No automated click — always fired within microseconds of menu-open, with no intervening editor state change — ever landed inside that reattachment window, which is why it could not be reproduced. It remains a genuine latent race under real, differently-timed usage, not a confirmed explanation of the original report, and is disclosed as such rather than being overclaimed as "the" root cause.

## Fix

`packages/react/src/components/ContextMenu.tsx`:
- The outside-click effect now reads the latest `onDismiss` through a ref (`onDismissRef`) instead of depending on it directly, so the listener mounts exactly once for the menu's lifetime — eliminating the teardown/reattach churn regardless of how often the parent re-renders while the menu is open.
- Added a `mousedown` listener alongside `pointerdown` (same "is this outside the menu" check) as defense-in-depth for any embedding context where `PointerEvent` isn't guaranteed to fire.

## Regression coverage

**None existed before this fix** — every prior context-menu e2e test (Phase 11.5 item 5's three tests) dismissed the menu by clicking one of its own items, which never exercises the outside-click path. `packages/react/e2e/canonical-authority.spec.ts` — "closes the context menu on outside click and on Escape" (new): opens the menu and dismisses via Escape, reopens and dismisses via a click on ordinary editor content, then reopens and dismisses via a click deliberately positioned outside the menu's own (viewport-clamped) bounds — all 3 browsers pass.

## Related/similar issues

None prior. Distinct from `docs/bugs/context-menu-viewport-overflow.md` (item 4 of this same batch) — that one is about the menu's own positioning/sizing, not the dismiss listener — though both were investigated together since a mispositioned menu could in principle make an intended "outside" click land back on the menu; that specific interaction was not what was found here.
