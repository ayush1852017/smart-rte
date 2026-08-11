# Link toolbar route did not distinguish creating a link from editing an existing link

**Status:** Fixed
**Area:** mark / link / toolbar
**First reported:** 2026-08-05 (canonical toolbar manual testing; reported as “link is not working”)
**Related files:** `docs/PHASE_4_COMPLETION_REPORT.md`, `docs/PHASE_8B_COMPLETION_REPORT.md`

## Symptom

The Link toolbar path worked for some fresh selections but did not reliably edit an existing link run. The user-visible result was that Link appeared not to work, especially when the caret was already inside a link.

## Reproduction

Create a link, place the caret inside it, invoke Link again, and supply a new URL. The route must edit the existing link run rather than apply a second/zero-width mark operation. A fresh selected text range must still create a link.

## Root cause

The canonical toolbar did not distinguish an existing link mark from a new-link application before dispatching the generic mark command. The mark engine already had separate apply/edit semantics; the missing piece was toolbar routing based on the current `describe` mark coverage.

## Fix

`packages/react/src/components/CanonicalAuthorityEditor.tsx` now derives whether the current description contains a link mark and dispatches `editLink` for an existing link, otherwise `apply`. The route restores focus after the dialog. URL validation remains the Phase 4 shared policy; no second URL validator was introduced.

## Regression coverage

`packages/react/e2e/formatting-workflows.spec.ts` covers native link creation and `packages/react/e2e/canonical-authority.spec.ts` includes the retained/canonical link intent. Core mark/link tests cover collapsed removal, ranged removal, inclusive boundaries, and URL rejection.

## Related/similar issues

- [list-marker-competing-style-and-preset-signals](list-marker-competing-style-and-preset-signals.md) — another toolbar route that initially appeared additive but had a distinct list-attribute cause.
- [block-type-dropdown-stale-on-caret-move](block-type-dropdown-stale-on-caret-move.md) — toolbar state synchronization, not command semantics.
