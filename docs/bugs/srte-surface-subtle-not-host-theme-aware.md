# Blockquote (and other neutral surfaces) rendered light-mode colors even though the host page was in dark mode

**Status:** Fixed
**Area:** react / theme.ts (CSS custom properties) + MediaManager.tsx
**First reported:** 2026-08-31, "On darkmode blockquote text showing" - screenshot from real Sootr usage: a blockquote rendered with a light-gray background and near-white text, both against the page's own dark background, making the text essentially invisible. "Our editor should be intelligent enough to change text color to respective readable."
**Related files:** `packages/react/src/theme.ts`, `packages/react/src/components/MediaManager.tsx`, `packages/react/e2e/theme-host-token-fallback.spec.ts`

## Investigation

Ruled out two plausible theories with direct evidence before finding the real cause, per this project's standing rule to verify rather than guess-fix:

- **Not stale/leaked inline styles from the old pre-migration editor**: asked for and received the actual rendered `<blockquote>` HTML - pure clean `data-smart-id`/`data-smart-type` markup, zero `style` attributes anywhere. Also confirmed the new canonical editor's own `serializeCanonicalListHtml` never emits any styling at all for blockquote (`<blockquote data-smart-id="...">`, nothing else) - so this wasn't contaminated saved content from before the upgrade.
- **Not a CSS class-name mismatch** (the pattern found repeatedly elsewhere in Sootr's own `globals.css` this session - `stale-dist-build-confusion.md`'s general shape): the live editor's own `.srte-editor [contenteditable] blockquote` CSS already correctly used theme-aware CSS custom properties, so this wasn't a dead-selector problem either.

The decisive evidence came from asking for actual **computed** style values plus whether `.dark` was present anywhere in the ancestor chain: `<html class="dark">` was confirmed present, but the blockquote's computed `background-color` was `rgb(243, 244, 246)` (`#f3f4f6`) - the package's own *light*-mode `--srte-surface-subtle` value - while its computed `color` was `rgb(248, 250, 252)` (`#f8fafc`) - the package's own *dark*-mode `--srte-foreground` fallback value. Both variables are defined in the same `.srte-editor.srte-dark { ... }` block, so a single class toggle can't apply one and not the other - meaning `.srte-dark` almost certainly *wasn't* actually being applied to this editor instance at all, and the two properties were resolving through entirely different mechanisms:

- `--srte-foreground: var(--foreground, #0f172a)` (light) / `var(--foreground, #f8fafc)` (dark) - every neutral token in the palette (`--srte-background`, `--srte-foreground`, `--srte-muted`, `--srte-muted-foreground`, `--srte-border`) is defined this way: **read the host's own same-named CSS variable first, only fall back to a hardcoded value if the host doesn't define one.** Sootr already defines its own `--foreground` (redefined under `.dark` at the root), so `--srte-foreground` picks that up correctly via ordinary CSS custom-property inheritance, *regardless of whether `.srte-dark` is ever applied* - explaining why the text color looked dark-mode-correct.
- `--srte-surface-subtle: #f3f4f6` (light) / `#333333` (dark) - a bare hardcoded hex with **no host-token fallback at all**, the one inconsistency in an otherwise carefully-designed palette. With `.srte-dark` not applied, it could only ever resolve to its light default.

Confirmed with an isolated reproduction: installed Sootr-equivalent host `--card`/`--foreground`/`--muted`/`--border` dark-mode tokens on `<html class="dark">`, deliberately *without* adding `.srte-dark` to the editor (matching the confirmed live evidence) - the blockquote rendered exactly the reported symptom (light background, dark-mode text) before the fix.

## Fix

Retired `--srte-surface-subtle` entirely (its light/dark values were near-identical to the already-correctly-integrated `--srte-muted`, making it redundant as well as inconsistent) and switched its two use sites (`blockquote` background, table `th` background) to `var(--srte-muted)`.

Also audited the rest of the palette for the same gap and found one more real instance: `--srte-modal-bg`/`--srte-modal-text` (bare `#ffffff`/`#000000` light, `#1e293b`/`#e0e0e0` dark) - used across six real, user-facing panels (`MediaManager.tsx`, `MediaPicker.tsx`, `CommentThreadPanel.tsx`, `SuggestionPanel.tsx`, `VersionHistoryPanel.tsx`), all exposed to the exact same latent bug. Fixed to `var(--card, #ffffff)` / `var(--foreground, #000000)` (and their dark counterparts), matching the established pattern.

`MediaManager.tsx` had five of its own inline-style references to `var(--srte-surface-subtle)` (tab backgrounds, an upload-drop-zone background) - updated to `var(--srte-muted)` to match; these would otherwise have silently resolved to nothing once the CSS variable was removed.

Verified directly: with the same host-dark-tokens-but-no-`.srte-dark` reproduction, blockquote background/text and a table header's background all now resolve to the host's actual dark values (`rgb(51, 65, 85)` / `rgb(248, 250, 252)`), matching the user's own framing - "the editor should be intelligent enough" - by following a host's real theme wherever a token exists, rather than depending solely on one boolean class that a host might fail to wire up correctly.

**Intentionally left unchanged**: `--srte-accent`, `--srte-primary`, `--srte-danger`, `--srte-code-bg`/`--srte-code-text` - these are the package's own branded/functional colors (a link/accent hue, a semantic error red, a GitHub-style code-block palette), not generic "surface following the host" cases; unlike a neutral background/text pairing, mismatching these against a host's own accent/primary tokens would be a worse default, not a better one. `--srte-cancel-bg` is defined but has zero actual usages anywhere in the codebase - left as-is, unrelated dead code outside this fix's scope.

## Regression coverage

New `packages/react/e2e/theme-host-token-fallback.spec.ts`: installs host-equivalent dark-mode CSS variables on `<html class="dark">` *without* ever applying `.srte-dark` to the editor (the exact confirmed-live scenario), then asserts blockquote background/text and a table header's background all resolve to the host's real dark values, not the package's light defaults. 6/6 across all three engines.

## Related/similar issues

`stale-dist-build-confusion.md`, `sootr-toolbar-mashed-labels-stale-dev-server.md` (the general "found a plausible cause, needed direct evidence to actually confirm it" investigative pattern - this bug specifically needed computed-style values, not just the raw HTML, to distinguish the real mechanism from two other plausible-looking theories).
