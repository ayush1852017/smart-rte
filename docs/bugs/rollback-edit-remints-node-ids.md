# Rolling back to the legacy editor remints canonical node IDs

**Status:** Open — promotion/annotation identity risk
**Area:** authority / rollback / identity / collaboration
**First reported:** 2026-08-05 (Phase 8b completion report)
**Related files:** `docs/PHASE_8B_COMPLETION_REPORT.md`, `docs/PHASE_8B_DELTA_REPORT_2.md`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`

## Symptom

Content survives a canonical → legacy rollback edit → canonical reload, but node IDs do not. Any comment, annotation, suggestion, or future collaboration reference keyed to a node ID can therefore point at an orphaned node after a rollback edit.

## Reproduction

1. Start with a canonical document containing a paragraph or atom with a known stable ID.
2. Serialize it to the clean HTML rollback envelope.
3. Edit that HTML through the retained legacy surface.
4. Re-enter canonical authority and compare the corresponding node IDs.

The text and visible structure survive; the IDs at the HTML boundary are reminted.

## Root cause

The rollback boundary intentionally serializes clean HTML and reparses it. Clean HTML strips `data-smart-id`, and the canonical parser creates fresh IDs for nodes that no longer carry one. The current path is `legacyDocument()` in `packages/react/src/components/CanonicalAuthorityEditor.tsx:512-515`; this is an identity-preservation limitation of the rollback format, not a failure of the normal `setNodeType`/move/undo identity contract.

## Fix

None yet. The current rollout decision explicitly treats rollback as content-safe but not annotation-safe. Before annotations or collaboration rely on rollback, preserve an ID-bearing canonical envelope across the flag transition or add a stable mapping/reconciliation layer; do not silently call the current HTML round-trip identity-safe.

## Regression coverage

`canonicalEditorRuntime.test.tsx` covers canonical/legacy/canonical content preservation and flag precedence, but it does not assert node-ID preservation across a legacy edit. Add that identity test when the rollback contract is changed. Phase 1 identity tests remain valid for canonical operations that do not cross the HTML boundary.

## Related/similar issues

- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — canonical stable-ID mapping is correct there; this issue is specifically the legacy HTML rollback boundary.
- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — semantic node selection depends on IDs inside canonical state, but its selectionchange race is a separate fixed issue.
