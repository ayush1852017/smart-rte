# Phase 11 Tier 0 completion report — live data loss and the input.ts wiring gap

**Verdict: Complete.** Both stop-condition items from the Phase 11 spec are fixed, not merely tracked: marks are now preserved through `repair()` (`docs/bugs/plugin-disable-marks-is-lossy.md`), and `surface/input.ts`'s Tab handler now genuinely calls the plugin shortcut dispatcher (`docs/bugs/input-ts-not-wired-to-plugin-shortcut-dispatch.md`). Both ledger entries are updated to Status: Fixed with the actual fix description. Reported separately from Tiers 1–3, which have not been started, per the spec's own instruction to report Tier 0 on its own once items 1.1/1.2 close.

Per `CLAUDE.md`'s standing rule, `docs/bugs/` was checked before starting — both items were already-filed entries from the Phase 10 closeout, not fresh investigations.

## A. Implemented interfaces (verbatim)

`packages/core/src/foundation/schema.ts` — new exports:
```ts
export const baseSchema: SchemaContribution = { nodes: [...], marks: [
  { type: "unknown-mark", attributes: { originalType: { required: true, ... }, originalAttrs: {} } },
] };
export const foundationRegistry: PluginRegistry = createPluginRegistry(builtInPlugins, { baseSchema, schemaVersion: 2 });
export const foundationSchema: SmartSchema = foundationRegistry.schema;
export const restoreUnknownMarks = (document: SmartDocument, schema: SmartSchema): SmartDocument => { ... };
```

`packages/core/src/foundation/plugin/dispatch.ts` — `resolveShortcut`'s signature changed:
```ts
// before (Phase 10, static scope-kind match):
resolveShortcut(shortcuts, event, scopeKind: ScopeKind): KeyboardShortcutContribution | null
// after (Phase 11 Tier 0, fallback dispatch):
resolveShortcut(
  shortcuts: readonly KeyboardShortcutContribution[],
  event: KeyLike,
  tryShortcut: (shortcut: KeyboardShortcutContribution) => readonly SmartOperation[] | null,
): { shortcut: KeyboardShortcutContribution; operations: readonly SmartOperation[] } | null
```

`packages/core/src/foundation/editor.ts` — `FoundationEditorOptions` gains `commands?: ReadonlyMap<string, PluginCommand>` and `keyboardShortcuts?: readonly KeyboardShortcutContribution[]`, both defaulting to `foundationRegistry`'s; `FoundationEditor` exposes both as new readonly properties.

`packages/core/src/foundation/block/plugin.ts` — new `block.code.indentTab` `PluginCommand` and `blockPluginShortcuts` export. `packages/core/src/foundation/list/plugin.ts` — new `listPluginShortcuts` export (`list.indent`, `list.outdent`).

## B. Deviations from spec

The spec framed both items as close to mechanical ("the shape of the solution is proven" for 1.1; "rewire the branches... replacing the hardcoded if-chain" for 1.2). Investigation before planning found 1.1 was indeed mechanical, but 1.2 was not — three real gaps, none apparent from the spec text:

1. No built-in plugin registered any real `keyboardShortcuts` contribution; `dispatch.test.ts`'s Phase 10 "proof of equivalence" used entirely synthetic, hand-invented contributions.
2. The code-block Tab case (`indentInsideCodeBlock`) returned a `CodeBlockInputResult`, not the bare `SmartOperation[]` a `PluginCommand.run` requires — there was no command to point a contribution at.
3. `ScopeKind` cannot distinguish a code block from a plain paragraph (`resolveScope.ts` gives both `"block-range"`), so `resolveShortcut`'s original static "one scope-kind owns this key" design could not actually reproduce `input.ts`'s real dynamic fallback precedence (try code, else list, else native fallthrough). Phase 10's equivalence test was proven against hand-picked labels, never against what `resolveScope` returns for a real document.

This is reported here rather than silently absorbed, per this project's standing pattern (Phases 8c and 10 both found their kickoff specs assumed stale/inaccurate prior state) — see the roadmap memory's "recurring pattern worth watching for."

## C. Locked decisions

Presented to the user as a genuine two-way architecture fork before planning (`AskUserQuestion`): fix `resolveShortcut` to try candidates in priority order and advance past any that produce no operations ("fallback dispatch"), versus extending the `ScopeKind` taxonomy with a new code-block-specific kind, versus leaving the code-block case as a permanent special case outside the dispatcher. **Chosen: fallback dispatch.** Smaller and more surgical than a taxonomy extension, needs no new `ScopeKind`, and is the only option that actually makes gate 2's claim true (a plugin registering a shortcut has real effect) rather than reopening the same gap under a different name.

Mark preservation design (not asked, since the better option was unambiguous): preserve an unrecognized mark as a sentinel *within* the existing `marks` array (`{type: "unknown-mark", attrs: {originalType, originalAttrs}}`) rather than adding a new field to `SmartTextNode`. No type-shape changes anywhere; mirrors the node-side `unknown` mechanism exactly.

## D. Exit gate results

| # | Gate | Result |
|---|---|---|
| 1 | Marks round-trip through `repair()` when unrecognized — no silent drop | **Pass** — property test in `foundation.test.ts`, plus `disableSafety.test.ts`'s marks describe block flipped from asserting loss to asserting a full round trip |
| 2 | `surface/input.ts` calls `resolveShortcut`; synthetic-plugin-shortcut e2e passes; no pre-existing keyboard test regresses | **Pass** — `input.ts`'s Tab handler calls `resolveShortcut` for real (§J); `shortcutIntegration.test.ts` proves a synthetic non-built-in plugin's shortcut has real effect; full 3-browser e2e unchanged from baseline (§F) |

Both are the phase's stop conditions; nothing else in the phase was started ahead of them.

## E. Known gaps and TODOs

- Tiers 1–3 of Phase 11 (manual a11y/IME/clipboard validation, the 29 deferred e2e tests, the marks/blocks codec slice, real-document performance, `content-visibility`, clipboard corpus expansion, security review) are **not started**. Tier 0 was the explicit stop condition; per the spec, nothing else should proceed ahead of it, and this report is filed on that basis rather than waiting for the full phase.
- **Correction (2026-08-19, during Tier 1–3 planning):** the atom-corpus CI assertion gap and the "Grow selected atom" toolbar button were incorrectly listed above as open Tier 1–3 debt. Both were already fixed a week before this report was written, in Phase 8b — atom-corpus: commit `88feed4`, `packages/react/e2e/canonical-authority.spec.ts:368-373` already asserts both `listCorpus` and `atomCorpus`; the button: `docs/bugs/atom-resize-selection-lost-after-click.md` (Status: Fixed), `CanonicalAuthorityEditor.tsx:641` conditionally enables correctly. Neither was re-verified against current state before being carried into this report's list — both are re-confirmed passing on the current tree (`runs the retained/canonical command replay in the selected browser` and `routes lists, links, tables, atoms, resize, import, and export through retained state`, all 3 browsers) and are removed from Phase 11's remaining scope.
- `resolveShortcut`'s `tryShortcut` callback pattern means `surface/input.ts` still special-cases `list.indent`/`list.outdent`'s dynamic per-invocation params (`nestedListIds`/`splitListIds`, which need a fresh id each call, not a static `KeyboardShortcutContribution.params`) and each contribution's `selectionTarget`/`intent` construction. This is consistent with how every other id-generating command call in this codebase already works (e.g. `CanonicalAuthorityEditor.tsx`'s table commands), not a shortcut taken here — but a future shortcut contribution needing dynamic params will need the same small per-commandId handling in `input.ts`, not a generic mechanism.
- No shortcuts beyond Tab/Shift+Tab were converted to the dispatcher (e.g. Cmd/Ctrl+B/I/U, Cmd/Ctrl+Z/Y remain their own hardcoded branches in `input.ts`, unchanged) — out of scope for this pass, which targeted the two Tier-0-named items only.

## F. Verification results

- Core: 592 (pre-Tier-0 baseline, re-confirmed) → **595/595** (+3: the plugin-independent mark-preservation property test, the `block.code.indentTab` command test, the synthetic third-party shortcut integration test).
- React: **92/92**, unchanged.
- Full 3-browser e2e (`chromium`/`firefox`/`webkit`, all spec files, no filter): **253 passed / 5 skipped / 0 failed**, run twice. First run hit one WebKit-only failure (`canonical-surface.spec.ts` — "Backspace merges into the deepest preceding descendant and Delete mirrors forward", unrelated code path to this pass's changes); matched a previously documented full-suite-load flake (`docs/bugs/webkit-full-suite-timeout-flake.md`, same test, same shape), confirmed by an isolated re-run passing clean, then a full second run passing 253/5/0 with no failures at all. Not disclosed as hidden — surfaced here per the standing rule to disclose partial/flaky runs.
- `pnpm run lint`: green, including `lint:phase10-contract`, which was itself updated (§H) and now additionally asserts `surface/input.ts` calls `resolveShortcut` — a gate that would have caught this exact bug had it existed at Phase 10 closeout.
- `pnpm --filter smartrte-core run build` run before every `packages/react`/e2e verification pass, per this project's established stale-dist lesson.

## G. Open questions blocking Tier 1

None specific to starting Tier 1's automatable items (e2e coverage gaps, the atom-corpus gate, the "Grow selected atom" fix, the codec slice). Tier 1's manual validation debts (NVDA + Chrome, physical-device IME, native Windows Word clipboard capture) require access this agent doesn't have (screen readers, physical devices, native Windows) and should be flagged to the user as needing to be scheduled separately, not something to silently skip or fake evidence for.

## H. Scope leakage

- `scripts/check-phase10-contract.mjs` (gate 5) was modified — not new work invented, but a necessary correction: the old check asserted the literal string `scopeKinds.includes(scopeKind)`, which no longer exists after the approved `resolveShortcut` redesign, and the old check never verified `input.ts` actually called the dispatcher (part of why this bug went undetected through Phase 10 closeout). Fixed in place rather than deleted, and strengthened to close that detection gap.
- `docs/plugins/block.md` was regenerated (`pnpm run docs:plugins`) to include the new `block.code.indentTab` command — required by the existing `docs:plugins:check` gate, not optional.
- `schema.ts`'s `baseSchema` was changed from a private `const` to an exported `const` (no shape change) so the new `shortcutIntegration.test.ts` and `disableSafety.test.ts` (already had its own hand-duplicated copy) can build a registry against the real base schema instead of drifting fixtures — a small, low-risk export addition adjacent to the plugin-independence proof this pass required.

## I. Marks-drop fix verification

Property test (`packages/core/src/foundation/foundation.test.ts`, "preserves an unrecognized mark as unknown-mark on ordinary repair, independent of any plugin registry, and restores it once recognized again"):

```ts
const original: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "paragraph", id: "p", children: [{ type: "text", text: "hello", marks: [{ type: "a-mark-type-that-was-never-registered", attrs: { intensity: 2 } }] }] },
] };
const { doc: repaired, repairs } = repair(original, foundationSchema);
// repairs contains "preserve-unknown-mark"
// repaired's text node marks -> [{ type: "unknown-mark", attrs: { originalType: "...", originalAttrs: { intensity: 2 } } }]
// validate(repaired, foundationSchema) -> []
const restored = restoreUnknownMarks(repaired, laterSchemaThatRecognizesTheType);
// restored -> deepEqual(original)
```

The pre-existing `disableSafety.test.ts` test that locked in the lossy behavior was **flipped, not deleted**: its old assertion `expect(reEnabled).not.toEqual(original)` (documenting the mark could never come back) is now `expect(restored).toEqual(original)` (a real round trip), matching the pattern the other four built-in plugins' disable-safety tests already use. `git diff` confirms this is a modification of the existing test block, not a new file replacing a deleted one.

## J. input.ts rewiring diff

Full diff of the Tab handler and its imports (`packages/core/src/foundation/surface/input.ts`):

```diff
 import {
   backspaceAtListItemStart,
   deleteAtListItemEnd,
   enterInList,
-  indentList,
   listItemAt,
-  outdentList,
   setListChecked,
   type CommandContext,
   type ListInputResult,
 } from "../list/index.js";
+import { resolveShortcut } from "../plugin/dispatch.js";
 ...
 import {
   exitCodeBlock,
-  indentInsideCodeBlock,
   insertCodeBlockNewline,
   type CodeBlockInputResult,
 } from "../block/index.js";
 ...
     if (event.key === "Tab") {
       const active = this.editor.selection.head;
-      const codeResult = indentInsideCodeBlock(this.editor.document, active);
-      if (codeResult) {
+      const description = this.editor.resolveScope({ want: "describe" });
+      const inTable = "inTable" in description && Boolean(description.inTable);
+      const resolved = resolveShortcut(this.editor.keyboardShortcuts, { key: "Tab", shiftKey: event.shiftKey }, (shortcut) => {
+        const command = this.editor.commands.get(shortcut.commandId);
+        if (!command) return null;
+        if (inTable && (shortcut.commandId === "list.indent" || shortcut.commandId === "list.outdent")) return null;
+        const wanted = shortcut.scopeKinds[0];
+        if (wanted === "mixed" || wanted === "empty") return null;
+        const scope = this.editor.resolveScope({ want: wanted });
+        if (!("kind" in scope) || scope.kind !== wanted) return null;
+        const params = shortcut.commandId === "list.indent" ? { nestedListIds: [createNodeId()] }
+          : shortcut.commandId === "list.outdent" ? { splitListIds: [createNodeId()] }
+          : shortcut.params;
+        return command.run(this.editor.document, scope, params, this.commandContext());
+      });
+      if (resolved) {
         event.preventDefault();
-        this.commitStructuralResult(codeResult, "keyboard");
+        const { shortcut, operations } = resolved;
+        const selectionTarget = shortcut.commandId === "block.code.indentTab"
+          ? { ownerId: ownerAt(this.editor, active).id, offset: active.offset + 1 }
+          : { ownerId: ownerAt(this.editor, active).id, offset: active.offset };
+        const intent = shortcut.commandId === "list.outdent" ? "outdent" : "indent";
+        this.commitStructuralResult({ operations: [...operations], selectionTarget, intent } as ListInputResult | CodeBlockInputResult, "keyboard");
         return;
       }
-      const item = listItemAt(this.editor.document, active);
-      const description = this.editor.resolveScope({ want: "describe" });
-      if (item && "inTable" in description && !description.inTable) {
+      if (!inTable && listItemAt(this.editor.document, active)) {
         event.preventDefault();
-        const scope = this.editor.resolveScope({ want: "list-selection" });
-        if ("kind" in scope) {
-          const operations = event.shiftKey
-            ? outdentList(this.editor.document, scope, { splitListIds: [createNodeId()] }, this.commandContext())
-            : indentList(this.editor.document, scope, { nestedListIds: [createNodeId()] }, this.commandContext());
-          if (operations.length) {
-            this.commitStructuralResult({ operations, selectionTarget: { ownerId: ownerAt(this.editor, active).id, offset: active.offset }, intent: event.shiftKey ? "outdent" : "indent" }, "keyboard");
-          }
-        }
         return;
       }
       // Tables own Tab navigation; the list layer deliberately yields.
       return;
     }
```

Two behavioral nuances from the original if-chain were deliberately preserved as explicit checks around the new dispatch call, not left to the dispatcher's generic contract:
- **The `inTable` exclusion**: `resolveScope({want: "list-selection"})` succeeds for a list nested inside a table cell (it has no awareness of tables), so without an explicit guard the list contribution would incorrectly win Tab inside such a list. `inTable` is computed once up front and checked only for the two list commandIds — the code-block contribution is deliberately not gated by it, matching the original chain where code-block indent always won regardless of table nesting.
- **"Claim Tab even with no legal indent"**: the original comment explains that `preventDefault()` must fire unconditionally for any list item outside a table, even when indent/outdent produces zero operations, or keyboard focus silently leaves the editor via native Tab-to-next-focusable behavior. This doesn't fit `resolveShortcut`'s "operations mean applicability" contract (an empty-operations candidate is correctly treated as "didn't apply" and passed over), so it's preserved as a small explicit post-check using the already-computed `inTable`/`listItemAt`, reached only when `resolveShortcut` returns null.

**Pre-existing keyboard e2e tests re-verified** (full 3-browser run, all passing, §F): `gives table navigation precedence over list Tab`, `Tab hoists an indented item's own nested children to siblings instead of moving the whole subtree`, `keeps keyboard focus inside the editor when Tab has no legal indent to apply`, `keeps outdent enabled when the selected item reaches maximum legal indent`, `keeps outdent enabled for a contiguous multi-item selection at maximum indent`, `keeps indent and unwrap-outdent available for a subset at depth zero`, `keeps mixed list-scope indent and outdent actions available after a partial unwrap`, `keeps the end of a converted code block editable at and away from document end`, plus the full non-Tab keyboard surface (Enter/Backspace/Delete/arrows/marks shortcuts/undo-redo), all in `canonical-surface.spec.ts` and `canonical-authority.spec.ts`.
