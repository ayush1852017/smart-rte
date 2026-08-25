# Ambient track-changes mode silently applies cross-paragraph edits directly, no UI signal

**Status:** Fixed (discoverability) - underlying scope limitation is by design, not fixed
**Area:** suggestions / surface input (`packages/core/src/foundation/surface/input.ts`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`)
**First reported:** 2026-08-25 (pasted "Codex prompt" item 1, self-identified as a risk during Phase 12a's ambient track-changes implementation, not an external bug report)
**Related files:** `docs/PHASE_ROADMAP_8B_12B.md`'s Phase 12a status note

## Symptom

With the "Track changes" toggle on, two specific actions still edit the document directly instead of producing a reviewable suggestion, with **no indication to the user that this particular edit bypassed suggestion mode**: (1) typing over a selection that spans multiple paragraphs, and (2) Backspace/Delete at a paragraph boundary (the `deleteAcrossBlock` cross-block merge). A user could reasonably believe every edit is being tracked, perform one of these two actions, and have it apply immediately and irreversibly-as-a-suggestion.

## Reproduction

Core: `phase2_5.test.ts`'s "falls back to real (non-suggested) editing for a selection crossing paragraphs" and "does not change the real cross-block Backspace merge (deleteAcrossBlock) even when enabled" (both added during Phase 12a, still passing). e2e: `suggestions.spec.ts`'s "ambient track-changes mode: typing over a selection spanning two paragraphs still merges them directly, not as a suggestion" and "...Backspace at a paragraph boundary still merges directly...".

## Root cause

Both excluded cases require representing a **proposed paragraph merge** to render as a genuine suggestion - a materially different suggestion shape from either of the two primitives Phase 12a §2.3 built (inline mark-based insert/delete on real text; whole-node-removal via `AnnotationRange`). Typing over a cross-paragraph selection and `deleteAcrossBlock`'s Backspace/Delete merge both concatenate two paragraphs' content into one surviving node - there is no way to mark "the boundary between these two blocks is proposed for removal" using an inline text mark, and representing it as a real, live change (matching how insert/delete suggestions are real, live, marked content) would require the document to actually merge while still being reversible-as-a-suggestion, which needs a new "structural merge suggestion" category this phase did not build.

Investigated and explicitly declined to build in this pass (2026-08-25): extending ambient interception to close either gap would require exactly this new suggestion category, which reopens the same merge-orphan/selection-mapping complexity already hardened four times this project. Not a small, safe addition.

## Fix

Not a document-model fix - a discoverability fix. `CanonicalAuthorityEditor.tsx`'s "Track changes" toolbar button now carries a `title` tooltip stating the scope plainly: "Tracks ordinary typing and edits within a single paragraph as suggestions. Merging paragraphs together - typing over a selection that spans multiple paragraphs, or pressing Backspace/Delete at a paragraph boundary - still applies directly and can't be reviewed as a suggestion." Chosen over an interruptive toast/warning (no toast infrastructure exists in this codebase yet, and building one for a narrow, non-destructive, already-longstanding editor behavior was judged disproportionate) and over doing nothing (a passive, always-available signal was judged necessary given how easily "every edit is tracked" could be silently assumed).

## Regression coverage

- `packages/react/e2e/suggestions.spec.ts`: "ambient track-changes mode: the Track changes toggle documents its two excluded cases" (tooltip text present and matches), plus the two real-scenario tests named above confirming the underlying behavior the tooltip describes is still accurate. Stable across 3 runs × 3 browsers.

## Related/similar issues

Same root complexity as `comment-lost-on-cross-block-backspace-merge.md` (a `deleteAcrossBlock`-adjacent gap) but a different resolution: that one was a genuine silent-data-loss bug with a real, small fix (`mergedInto` marking); this one is a scope boundary that was always going to exist given the hybrid architecture decision, addressed by making it visible rather than by closing it.
