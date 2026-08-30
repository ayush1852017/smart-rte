# `ClassicEditorProps.onChange` was typed as also accepting a plain HTML string, but always fired with the canonical change object

**Status:** Fixed
**Area:** react / legacy compat
**First reported:** 2026-08-30, independently flagged both by the npm pre-publish audit (`docs/PHASE_PRE_PUBLISH_AUDIT.md` §7e) and by the Sootr migration-readiness investigation (`docs/SOOTR_MIGRATION_READINESS.md` gap #2), which confirmed it as a live, guaranteed-to-break dependency for a real consumer, not a theoretical mismatch.
**Related files:** `packages/react/src/components/ClassicEditorAuthority.tsx`, `packages/react/src/canonicalEditorRuntime.ts` (`onHtmlChange`/`scheduleHtmlChange`), `packages/react/src/standalone/classic-editor-embed.tsx`

## Symptom

`ClassicEditorProps.onChange` was typed as a union: `((change: SmartEditorChange) => void) | ((html: string) => void)` - explicitly offering the pre-canonical string-based callback signature for backward compatibility. The actual implementation always called it with the new `SmartEditorChange` object (`{revision, documentChanged, transaction}`) regardless of which shape the caller's function actually expected, with no type error. A real consumer written against the old, string-based API (confirmed via Sootr's `app/components/RichTextEditor.tsx`: `onChange: (html: string) => void`, used directly as form state and passed into an autosave pipeline expecting a string) would have every edit silently store `"[object Object]"`-shaped garbage instead of real HTML.

## Root cause

`ClassicEditorAuthority.tsx` forwarded `CanonicalAuthorityEditor`'s own per-transaction `onChange` (object-based) straight through to `props.onChange`, without ever checking or adapting for the legacy string signature the type itself advertised as supported.

## Fix

`ClassicEditorProps.onChange` is now simply `(html: string) => void` (the union removed - the implementation could never actually honor the object half, so keeping it in the type was misleading, not flexible). Internally, this fires via the already-existing debounced HTML serialization mechanism (`onHtmlChange`, `canonicalEditorRuntime.ts`'s `scheduleHtmlChange` - ~250ms after the last edit, using `serializeCanonicalListHtml`), rather than the per-transaction `onChange` - that mechanism already existed for exactly this purpose and was simply never wired into the legacy-compat surface. `ClassicEditorProps` now `Omit`s both `onChange` and `onHtmlChange` from `CanonicalAuthorityEditorProps` (the latter repurposed internally, not separately exposed on this surface, to avoid two ways to get an HTML string with different names on the same component).

`packages/react/src/standalone/classic-editor-embed.tsx` had already independently worked around this exact bug by calling `onHtmlChange` directly instead of the broken `onChange` - updated to use the now-fixed `onChange` instead, removing the workaround.

Callers who need the structured per-transaction `SmartEditorChange` object should use `CanonicalAuthorityEditorProps` directly (unaffected by this change), not the legacy-compat `ClassicEditor`.

## Regression coverage

`packages/react/src/components/ClassicEditorAuthority.test.tsx` - "fires onChange with a plain HTML string, not a SmartEditorChange object": mounts `ClassicEditor`, makes a real edit via `runtime.editor.typeText`, advances the debounce timer, asserts the callback received a string containing the edit, not an object.

## Related/similar issues

`docs/PHASE_PRE_PUBLISH_AUDIT.md` §7e (where this was first flagged, before a real consumer's dependency on it was confirmed) - the audit's own recommendation ("implement the actual dual-dispatch the type promises, or narrow the type... and call it out explicitly") was resolved in favor of narrowing, once `docs/SOOTR_MIGRATION_READINESS.md` confirmed no real caller ever wanted the object shape from this specific legacy surface. `docs/SOOTR_MIGRATION_READINESS.md` gap #2 (the migration-side half of this same finding).
