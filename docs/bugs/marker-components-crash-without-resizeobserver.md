# Comment/suggestion markers threw "ResizeObserver is not defined" in jsdom

**Status:** Fixed (1.3.0, found while adding the media drag controller)
**Area:** react / CommentMarkers / StructuralSuggestionMarkers / tests
**First reported:** 2026-10-12, as 9 failures in `CanonicalAuthorityEditor.toolbarTools.test.tsx` during 1.3.0 development
**Related files:** `packages/react/src/components/CommentMarkers.tsx`, `packages/react/src/components/StructuralSuggestionMarkers.tsx`

## Symptom

After 1.3.0 started tracking the editing surface element as React state, which adds one extra render after mount, every jsdom test that mounts `CanonicalAuthorityEditor` logged `ReferenceError: ResizeObserver is not defined`, and nine toolbar tests failed.

## Reproduction

Run `npx vitest run src/components/CanonicalAuthorityEditor.toolbarTools.test.tsx` in `packages/react` with the 1.3.0 component change and no `ResizeObserver` stub. The stack points at `CommentMarkers.tsx:70` and `StructuralSuggestionMarkers.tsx:47`.

## Root cause

Both marker components call `new ResizeObserver(...)` unconditionally in an effect. Before 1.3.0 they happened not to mount during the first render in jsdom, because the surface ref was still null and nothing re-rendered. The extra post-mount render now reaches them. Real browsers all have `ResizeObserver`, so this only affected jsdom, including hosts' own test suites that mount the editor.

## Fix

Both components create the observer only when `typeof ResizeObserver === "function"`. Their `MutationObserver`, scroll and resize listeners still keep markers positioned without it.

## Regression coverage

`CanonicalAuthorityEditor.toolbarTools.test.tsx` runs without a `ResizeObserver` stub and passes, so it guards this.

## Related/similar issues

- [block-media-cannot-be-dragged](block-media-cannot-be-dragged.md): the 1.3.0 work whose extra render exposed this.
