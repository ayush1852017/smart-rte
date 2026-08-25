# `surface/input.ts` still resolves shortcuts on its own hardcoded logic, not through the new plugin dispatcher

**Status:** Fixed (2026-08-19, Phase 11 Tier 0).
**Area:** foundation / plugin / keyboard shortcuts / surface
**First reported:** 2026-08-18, during Phase 10 (noted in the completion report as a deliberate deferral); formally ledgered and fixed 2026-08-19.
**Related files:** `packages/core/src/foundation/plugin/dispatch.ts` (`resolveShortcut`), `packages/core/src/foundation/surface/input.ts` (Tab handler, now the real caller), `packages/core/src/foundation/block/plugin.ts` (`block.code.indentTab` command + shortcut), `packages/core/src/foundation/list/plugin.ts` (`list.indent`/`list.outdent` shortcuts), `packages/core/src/foundation/editor.ts` (`FoundationEditor.commands`/`keyboardShortcuts`), `scripts/check-phase10-contract.mjs` (gate 5, now also asserts `surface/input.ts` calls `resolveShortcut`)

## Symptom

Phase 10 built a scope-kind + priority based keyboard-shortcut dispatcher (`resolveShortcut`), proven by a synthetic test to reproduce `surface/input.ts`'s hardcoded Tab precedence — but `input.ts` itself was never rewired to call it, and no built-in plugin registered any real `keyboardShortcuts` contribution. A plugin registering or reprioritizing a shortcut had zero effect on the live editor.

## Investigation found the fix was bigger than "swap the if-chain for a call"

Three things made this more than a mechanical rewiring, discovered before any code was written:

1. **No built-in plugin registered a real `keyboardShortcuts` contribution.** `dispatch.test.ts`'s "proof of equivalence" used entirely synthetic contributions invented for the test.
2. **The code-block Tab case had no `PluginCommand` to point at.** `indentInsideCodeBlock` (`block/input.ts`) returns a `CodeBlockInputResult` (`{operations, selectionTarget, intent}`), not a bare `SmartOperation[]`.
3. **`ScopeKind` cannot distinguish a code block from a plain paragraph** — `resolveScope.ts` gives every block-touching selection the same `"block-range"` kind. Real Tab precedence is a dynamic fallback chain (try code, else try list, else let the browser handle it natively), not a static "one scope-kind owns this key" lookup, which is what `resolveShortcut` originally implemented. The old dispatch.test.ts's "equivalence" was proven against hand-picked labels, never against what `resolveScope` actually returns for a real document.

## Fix

- **`plugin/dispatch.ts`**: `resolveShortcut` now takes a `tryShortcut: (shortcut) => SmartOperation[] | null` callback and tries key-matching contributions in priority order, returning the first that actually produces operations, instead of statically filtering by a precomputed scope-kind label. `scopeKinds` on a contribution is now the metadata a caller's `tryShortcut` uses to pick which `resolveScope({want})` to attempt, not something `resolveShortcut` filters by directly.
- **`block/plugin.ts`**: new `block.code.indentTab` `PluginCommand` wrapping `indentInsideCodeBlock`, plus a real `keyboardShortcuts` contribution (`Tab`, `scopeKinds: ["block-range"]`, `priority: 20`).
- **`list/plugin.ts`**: real `keyboardShortcuts` contributions for `list.indent` (`Tab`) and `list.outdent` (`Shift+Tab`), both `scopeKinds: ["list-selection"]`, `priority: 10` — lower than code's, reproducing the original precedence.
- **`editor.ts`**: `FoundationEditor` now exposes `commands`/`keyboardShortcuts` (defaulting to the built-in registry's, mirroring how `schema` already defaults to `foundationSchema`), so a caller constructing an editor with a custom plugin list gets real command/shortcut lookup, not just a custom schema.
- **`surface/input.ts`**: the Tab handler now calls `resolveShortcut(this.editor.keyboardShortcuts, event, tryShortcut)`, where `tryShortcut` resolves the candidate's declared scope via `this.editor.resolveScope` and runs its command via `this.editor.commands.get(...)`. The pre-existing `inTable` exclusion (a list nested inside a table cell still yields Tab to the table) and the "claim Tab even with no legal indent, so focus doesn't leave the editor" behavior are preserved as explicit checks around the dispatch call, since those are input-focus-retention policy, not generic dispatch semantics.
- **`scripts/check-phase10-contract.mjs`**: gate 5 updated to assert `resolveShortcut` is fallback-based (not the old static scope-kind match) *and* that `surface/input.ts` actually calls it — closing the loophole that let this gap exist undetected: the gate previously only checked the dispatcher existed, not that anything real used it.

## Regression coverage

- `packages/core/src/foundation/plugin/dispatch.test.ts` rewritten to drive the new fallback signature, including a case proving the dispatcher advances past a matched-but-inapplicable candidate (the exact scenario the old test couldn't express).
- `packages/core/src/foundation/block/plugin.test.ts`: `block.code.indentTab` produces a tab-insert operation inside a code block and no operations outside one.
- `packages/core/src/foundation/plugin/shortcutIntegration.test.ts` (new): a synthetic, non-built-in plugin registers a novel shortcut via `createFoundationEditor({ commands, keyboardShortcuts })`; asserts the shortcut reaches `FoundationEditor.keyboardShortcuts`/`commands` and that dispatching it through `resolveShortcut` (the same three calls `surface/input.ts`'s Tab handler makes) produces real operations that change the live document — the regression test this bug could not have had before the wiring existed.
- Full 3-browser e2e (all existing Tab-precedence scenarios: code-block indent, list indent/outdent including table-nested-list exclusion, "keeps keyboard focus inside the editor when Tab has no legal indent") — 253 passed / 5 skipped / 0 failed, matching the pre-fix baseline exactly.
- Full suite: core 595/595, react 92/92. `pnpm run lint` green, including the strengthened gate 5.

## Related/similar issues

[plugin-disable-marks-is-lossy](plugin-disable-marks-is-lossy.md) — the other Phase 10 exit-review finding, fixed in the same Phase 11 Tier 0 pass; unrelated root cause.
