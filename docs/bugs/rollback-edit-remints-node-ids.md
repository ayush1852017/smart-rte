# Rolling back to the legacy editor remints canonical node IDs

**Status:** Fixed by deletion — the mechanism this bug describes no longer exists in product code
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

**Closed by deletion, verified during Phase 8c item 4 (2026-08-18).** `legacyDocument()` and the entire `LegacyClassicEditor` DOM-authoritative rollback path — the code this bug's root cause pointed at — were removed in `60adfb7` ("feat(react)!: retire LegacyClassicEditor, the DOM-authoritative rollback path") and `cb05f88` ("feat(react)!: remove canonicalAuthorityFlag entirely (Phase 9 §1.1)"). There is no longer a canonical → clean-HTML → legacy-DOM-edit → reparse boundary anywhere in the product: `git grep -n "legacyDocument\|LegacyClassicEditor" packages/react/src packages/core/src` returns zero product-code hits — only unrelated, differently-named list/table shadow-comparator test infrastructure (`packages/core/src/foundation/list/shadow.ts`, `packages/react/src/adapters/legacyListShadowComparator.ts`, `packages/react/src/test-harness/tableShadowComparator.ts`) and one historical doc-comment in `packages/react/src/components/ClassicEditorAuthority.tsx:39`.

The only other path that could plausibly be called a "rollback" today — checkpoint/version restore — is safe by construction: `restoreCheckpoint` (`packages/react/src/canonicalEditorRuntime.ts:319-324`) calls `this.editor.replaceState(checkpoint.envelope, ...)` with a structured `PersistedEditorDocument`, serialized/parsed via `serializePersistedDocument`/`parsePersistedDocument` (`packages/core/src/foundation/schema.ts:408-411`) — a JSON round-trip where node IDs are first-class fields, never an HTML boundary that could strip and remint them.

**Forward-looking flag, not a fix:** if a future feature adds an HTML-based restore/import surface (e.g. an "restore from exported HTML" recovery feature, conceivably in Phase 12a), it would need the same identity scrutiny this bug documents. Recommend adding a standing ID-preservation regression test on whatever module owns that surface if/when it's proposed — do not assume safety carries forward automatically just because this specific mechanism is gone.

## Regression coverage

No code changed by this closure — verification was read-only (`git log`, `git grep`, and direct inspection of `restoreCheckpoint`'s envelope-based data flow). `canonicalEditorRuntime.test.tsx`'s existing coverage of checkpoint restore already exercises the JSON-envelope path this bug's fix relies on being identity-preserving; no new test was added since there is no live code path left to regress. If a future HTML-based restore surface is added, add a dedicated ID-preservation test at that point (see flag above).

## Related/similar issues

- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — canonical stable-ID mapping is correct there; this issue is specifically the legacy HTML rollback boundary.
- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — semantic node selection depends on IDs inside canonical state, but its selectionchange race is a separate fixed issue.
