# Color picker redesigned: in-page drag square/slider, no Apply/Cancel, Discard is the only revert

**Status:** Fixed (2026-08-30) — feature redesign per explicit owner request, not a defect fix; logged per the standing ledger convention since it replaces the entire prior interaction model and needed the same care as the two prior native-input incidents in this same component.
**Area:** react / ColorPickerPopover.tsx, CanonicalAuthorityEditor.tsx
**First reported:** "No need of giving apply and cancel button at color picker. Dragging should update the color, just give discard button for in case. Color picker shouldn't take 2 clicks to open... show color drag palette on first click itself along with [a] discard button and 4 last used colors. But if user drag[s] and change[s] color and doesn't click on discard, closed overlay should apply that to text. Only discard can revert."
**Related files:** `packages/react/src/components/ColorPickerPopover.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Change

Replaced the native `<input type="color">` (which needed a second click to open its own OS-level dialog, and whose events this project had already hit two real bugs trying to trust as a commit signal - see Related) with a fully in-page, always-visible saturation/value square and hue slider, built from scratch (HSV↔RGB↔hex conversion, pointer-drag handling via `pointerdown`/`pointermove`/`pointerup`). The picker is now visible the instant the popover opens - one click, not two.

Commit model, replacing the old Apply/Cancel pair with a single Discard button:
- Dragging the square/slider, typing a valid hex, or clicking a recent swatch all **stage** a live preview (same non-history checkpoint-then-reapply mechanism as before - unchanged).
- Dismissing the popover **any way other than Discard** - outside click, Escape, the × button - **commits** whatever is currently staged.
- **Discard is the only way to revert** to the color the popover opened with. Opening and closing without ever touching anything is a true no-op (tracked via an internal "has anything been staged" flag), not a phantom identical-value commit.
- `RECENT_COLOR_LIMIT` reduced from 6 to 4, matching "4 last used colors" exactly; clicking a recent swatch now also stages (keeping the popover open) rather than committing immediately, for consistency with drag/type staging.

## Bug found and fixed while building this

Dragging silently did nothing on the first attempt: the square/slider `<div>`s are focusable (for keyboard arrow-key support), and clicking them to start a drag focused the div, collapsing the editor's native selection *before* the live-preview mark-apply could act on it. Same class of bug as the two immediately preceding fixes in this batch (the auto-triggered link overlay, the toolbar dropdown summaries) - fixed the same way, `onMouseDown={(e) => e.preventDefault()}` on both drag surfaces, which suppresses the browser's focus-on-click default without affecting the pointerdown-based drag handling or Tab-based keyboard access.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` and `canonical-toolbar-routing.spec.ts` - the entire pre-existing color-picker test suite was reworked for the new interaction model (no more native `<input type="color">`, no Apply button):
- "a real pointer drag on the saturation/value square and hue slider live-previews and commits on close, with no Apply/Cancel buttons" (new) - drags both controls with real mouse events (not the hex-input shortcut every other test uses), confirms the picker is visible on the first click, confirms no Apply/Cancel buttons exist, confirms a drag that's dismissed via outside click (never touching Discard) is applied.
- "Discard after a live preview reverts..." (renamed/rewritten from "canceling... reverts...") - Discard reverts; a second case in the same test confirms Escape, unlike Discard, **commits** rather than cancels - the literal, explicit "only discard can revert" requirement.
- "live-previews the color picker while staging..." (renamed from "...dragging...", staged via the hex input, which calls the identical `stage()` code path a real drag does) - no undo step per preview frame, exactly one on commit.
- "recently-used colors..." - updated for the 4-color retention limit (was 6) and the new stage-not-commit swatch-click behavior.
- "color picker reflects the existing colour when reopened..." and the cell-color context-menu test - native-input value assertions replaced with hex-input assertions (the value itself is unchanged; only the previously-duplicate check against a now-removed element was removed).
- Full `canonical-authority.spec.ts` (104/104) and `canonical-toolbar-routing.spec.ts` (16/16) re-run clean; core 721/721, react 132/132, lint clean.

## Related/similar issues

- [color-popover-closes-on-first-native-picker-interaction](color-popover-closes-on-first-native-picker-interaction.md) and [color-preview-render-steals-focus-from-popover](color-preview-render-steals-focus-from-popover.md) - the two prior incidents that made the native `<input type="color">` load-bearing-but-fragile in the first place; both are moot now that no native color-input event is used for anything (drag/commit are both fully page-owned pointer events).
- [link-overlay-autofocus-steals-editor-focus-on-plain-click](link-overlay-autofocus-steals-editor-focus-on-plain-click.md), [toolbar-dropdown-summary-steals-editor-focus](toolbar-dropdown-summary-steals-editor-focus.md) - the same focus-stealing-collapses-selection bug pattern, found a third time in this same batch and fixed the same way.
