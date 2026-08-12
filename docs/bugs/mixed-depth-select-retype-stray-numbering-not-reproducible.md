# "Selecting a full multi-level list and clicking Bullets/Numbering shows a stray '1.' alongside old markers" — not reproducible

**Status:** Not a bug / not reproducible — confirmed by owner manual check on 2026-08-12, following the exact steps below
**Area:** list / toolbar / renderer
**First reported:** 2026-08-11 (this project's ongoing list-toolbar bug hunt)

## Symptom

Reported: selecting an entire deeply-nested multi-level list (built up through many manual preset/indent operations) and clicking Bullets or Numbering produced a document where every line showed a stray "1." (not incrementing 1,2,3) alongside the pre-existing bullet markers from the old preset — described and shown via screenshot as clearly wrong.

## Reproduction

Three faithful reproduction attempts against the live-source dev server, in real Chromium — **none reproduced the reported symptom**, including one using a real mouse-drag selection specifically to rule out a native-selection-mapping bug. All three produced clean results at both the model level and the rendered DOM level (inspected via actual page HTML, not just the underlying data).

**Exact steps for a manual re-check on the current build** (open `http://localhost:5173/?canonicalAuthority=1`, hard-refresh first per [stale-dist-build-confusion](stale-dist-build-confusion.md)):

1. Build a multi-level nested list: type a line, make it a bulleted list, press Enter for a second item, press Tab to indent it one level, type more text, press Enter, press Tab again to go a level deeper. Repeat until you have at least 3 nesting levels with 2+ items at some levels — or, if you still have the original document that showed this problem, use that exact one instead of building a new one.
2. Click at the very start of the first (top-level) line of the list.
3. Hold Shift and click (or drag-select) all the way to the end of the last line in the list, so the entire list — every level — is selected.
4. Click the "Numbered list" toolbar button.
5. **Expected**: every line in the list now shows a number (1., 2., 3.,... continuing correctly down through nested levels), and the old bullet symbols are gone.
6. **If instead** you see a stray "1." on every line while the old bullet symbols are still also visible — that is the actual bug. **If this happens, please export the document (Export Native/JSON if available in the toolbar) or, if not available, take a screenshot immediately before and after clicking Numbered list** — this is more useful than a description, since two prior investigations of this exact symptom couldn't reproduce it from a description alone.

(The three original investigation attempts additionally covered a single 3-level chain and three top-level siblings with one deep chain, both via scripted selection and via a real mouse drag — all matching or exceeding the steps above.)

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
