# "Selecting a full multi-level list and clicking Bullets/Numbering shows a stray '1.' alongside old markers" — not reproducible

**Status:** Needs re-verification
**Area:** list / toolbar / renderer
**First reported:** 2026-08-11 (this project's ongoing list-toolbar bug hunt)

## Symptom

Reported: selecting an entire deeply-nested multi-level list (built up through many manual preset/indent operations) and clicking Bullets or Numbering produced a document where every line showed a stray "1." (not incrementing 1,2,3) alongside the pre-existing bullet markers from the old preset — described and shown via screenshot as clearly wrong.

## Reproduction

Three faithful reproduction attempts, all against the live-source dev server, all in real Chromium via Playwright — **none reproduced the reported symptom**:
1. A single deep chain (3 levels, one item per level), selected fully, Numbering applied via API-driven selection.
2. Three top-level siblings with only the last one carrying a deep nested chain, selected fully, Numbering applied via API-driven selection.
3. The same shape as (2), but with a **real mouse-drag selection** through the actual rendered UI rather than a scripted model selection (to rule out a native-selection-to-model-mapping bug specific to multi-depth drag selections).

All three produced completely clean, correct results at both the model level (uniform `style`/cleared `preset` cascaded to every level) and the rendered DOM level (`<ol>`/`<ul>` tags, `list-style-type`, no stray text, no leftover `data-srte-list-preset` attributes) — inspected via `innerHTML`, not just the model.

## Root cause

Not established — no defect found in three separate, faithful attempts including one using real native mouse selection specifically to rule out an input-mapping bug.

## Fix

None applied — there is nothing in current source to fix. Leading hypothesis, unconfirmed: the reporter's document was built up through many incremental manual operations across multiple sessions, possibly including operations from before other fixes in this same investigation landed (e.g. before [list-preset-invalid-bullet-circle-option](list-preset-invalid-bullet-circle-option.md) was fixed) — meaning the specific document may have carried forward some now-fixed inconsistency baked into its content. See also [stale-dist-build-confusion](stale-dist-build-confusion.md) as a standing alternative explanation for "looks broken, can't reproduce" reports in this project.

## Regression coverage

No new regression test was added for the unreproduced symptom itself (nothing to guard against). Related, already-passing coverage: [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md)'s and [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md)'s test suites cover the same general "apply a type change to a nested/multi-level list" surface and all pass.

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md)
- [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md) — a similarly unreproducible report from the same reporting session.
- [list-preset-invalid-bullet-circle-option](list-preset-invalid-bullet-circle-option.md) — if this resurfaces, check whether the reporter's specific document contains a `bullet-circle` (or other invalid) preset baked in from before that fix landed.
- **If this resurfaces**: get the exact document JSON (Export Native, if available) or the precise click sequence that built the structure — this is the second report in this project where guessing at a multi-step-built document's exact shape failed to reproduce a real symptom.
