# The auto-triggered link overlay stole focus from the editor on every plain click into a link

**Status:** Fixed (2026-08-29)
**Area:** react / LinkEditorPopover, CanonicalAuthorityEditor
**First reported:** "clicking anywhere on link text now shows the link overlay directly on top of the text, preventing the user from placing a cursor to edit text near/inside the link normally." Investigated as a possible Direction-B-toolbar-redesign regression (timing suggested it might be) - confirmed via `git stash` (reverting the redesign's `CanonicalAuthorityEditor.tsx` changes entirely, keeping the untouched `LinkEditorPopover.tsx`) that the bug reproduces identically either way. Pre-existing, not caused by the toolbar redesign.
**Related files:** `packages/react/src/components/LinkEditorPopover.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`linkAnchorElement` auto-trigger effect, `openLinkPopover`).

## Symptom

Clicking to place the cursor inside or near existing link text visually placed the caret correctly, but focus then immediately jumped away from the editor into the overlay's URL input - any further typing went into the link's href field instead of the document, and the click's own caret placement effectively became unusable.

## Reproduction

Real Playwright click into rendered link text (not the pre-existing e2e test's programmatic `setSelection`, which never exercises this): `document.activeElement` immediately after the click was the popover's `[data-srte-link-href-input]`, not the contenteditable. Typing "XYZ" afterward landed in the href field's value, not the document text.

The pre-existing e2e coverage (`"link overlay auto-appears when the caret enters a link, edits it, and dismisses correctly"`) never caught this because it deliberately avoids real clicks - its own comment states "A click's exact character offset depends on pixel geometry the test shouldn't need to know," so it drives the caret via `runtime.editor.setSelection(...)` instead. That path never contends for focus the way a native click does, so the auto-focus side effect was invisible to it.

## Root cause

[context-menu-scope-reduction](context-menu-scope-reduction.md) introduced an auto-trigger effect that opens `LinkEditorPopover` automatically whenever the caret enters an existing link, reusing the same component originally built for the toolbar's explicit "Link" button. `LinkEditorPopover`'s `useEffect(() => { hrefRef.current?.focus(); hrefRef.current?.select(); }, [])` is correct for that original, explicit-invocation case (the user asked to edit the link, so jump to the href field) - but once reused for the *auto*-trigger, the same unconditional autofocus fired on every ordinary click or caret move into a link, stealing focus from the editor before the user's own click could do anything with it. This directly defeated the auto-overlay's whole stated purpose - "clicking into a link doesn't trap the cursor."

## Fix

- `LinkEditorPopover` gained an `autoFocus?: boolean` prop (default `true`, preserving the toolbar-button path's exact existing behavior); the mount-time `hrefRef.current?.focus()` effect is now gated on it.
- `CanonicalAuthorityEditor.tsx`'s `linkPopover` state gained an `autoTriggered?: boolean` flag, set `true` only by the caret-auto-trigger effect (never by the toolbar button's `openLinkPopover`), and `autoFocus={!linkPopover.autoTriggered}` is passed to the popover.
- Escape-to-dismiss previously relied on the popover's own `onKeyDown`, which only fires while focus is *inside* the popover - now broken by design once autoFocus is false for the auto-triggered case. Moved Escape handling to a `window`-level `keydown` listener (added for the popover's whole mounted lifetime, removed on unmount) so it works regardless of where focus actually is; the div's own `onKeyDown` no longer duplicates Escape (would have double-dismissed when focus *is* inside), keeping only the Enter-to-apply handling that legitimately needs focus in a specific field.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - new: "a real click into link text keeps editor focus - the auto-triggered overlay must not steal it" - a real click into link text asserts the overlay still opens (unchanged) but the href input is *not* focused, the editor *is* focused, and typing afterward reaches the document, not the href field; then confirms the toolbar's own "Insert or edit link" button still autofocuses the href input exactly as before (the explicit-invocation path is intentionally unchanged). The pre-existing "link overlay auto-appears..." test (Escape-dismiss, genuine caret-move reopen, dismiss-on-selection-leaving-the-link) still passes unchanged, confirming the window-level Escape listener replacement didn't regress any of that behavior.

## Related/similar issues

[context-menu-scope-reduction](context-menu-scope-reduction.md) - introduced the auto-trigger effect this bug lived in from the start.
[link-overlay-blocks-ctrl-click-open](link-overlay-blocks-ctrl-click-open.md) - a different bug in the same auto-trigger area (Ctrl/Cmd+click's own caret-entry racing the overlay), already fixed separately; both concern the same overlay but via different mechanisms (that one is about *when* the caret enters a link at all, this one is about what happens to *focus* once it legitimately does).
