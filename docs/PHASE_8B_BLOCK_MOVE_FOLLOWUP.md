# Phase 8b block-move follow-up

**Scope:** renderer blast-radius check, rapid typing after moves, and table row/column reorder.

**Surface:** all browser checks used `?canonicalAuthority=1`.

## 1. Renderer-fix failure isolation

The stable-ID sibling branch in `packages/core/src/foundation/surface/renderer.ts`
was uncommitted in the dirty worktree. `HEAD` (`7e3883a`) predates that branch,
but checking it out would have discarded unrelated Phase 8b work. I therefore
ran the exact 12-test command with only the stable-ID branch removed as the
pre-fix control, then restored it and ran the same command after each correction:

```text
pnpm --dir packages/react e2e canonical-authority.spec.ts canonical-surface.spec.ts canonical-toolbar-routing.spec.ts \
  -g "replays generated complete command sessions|reconciles composition before, after, and between atoms|handles Enter start/mid/end and restores structural history|routes lists, links, tables, atoms, resize, import, and export"
```

| Test | Pre-fix control | First stable-ID implementation | Corrected implementation |
|---|---:|---:|---:|
| Generated authority replay, `canonical-authority.spec.ts:463`, 3 browsers | 3 failed | 3 failed | 3 failed |
| Broad toolbar route, `canonical-toolbar-routing.spec.ts:77`, 3 browsers | 3 failed | 3 failed | 3 failed |
| Composition before/after/between atoms, `canonical-surface.spec.ts:119`, 3 browsers | **3 passed** | **3 failed** | **3 passed** |
| List Enter start/mid/end, `canonical-surface.spec.ts:735`, 3 browsers | **3 passed** | **3 failed** | **3 passed** |
| **Total** | **6 failed / 6 passed** | **12 failed** | **6 failed / 6 passed** |

The six failures that remain in the corrected run are the same six failures in
the control run. They time out waiting for the disabled `Grow selected atom`
button (`canonical-toolbar-routing.spec.ts:109` and the generated-session
button route around `canonical-authority.spec.ts:328`); they are pre-existing
and are not renderer regressions.

The other six failures were caused by the renderer change and are fixed:

1. The initial stable-ID branch used the historical `modelById` entry as
   `old`, even when the same ID was already at the same position. That stale
   comparison dropped the `y` composition token and made list Enter reconcile
   the wrong split. The branch now prefers the immediately rendered
   `previous` node when its ID matches (`renderer.ts:389-397`), using the ID
   cache only for a real positional move.
2. Reusing an atom then recursed into its DOM payload. Formula source text is
   presentation, not model children, so the child-removal loop erased it. The
   renderer now treats `unknown`, schema-atomic payloads, and registered atoms
   as opaque after syncing attributes (`renderer.ts:356-362`).
3. The first revision also called `isTextNode(previous)` when a new trailing
   child had no positional predecessor. The guarded ID comparison at
   `renderer.ts:395-397` removes that undefined-predecessor exception; the
   full core run now has no unhandled renderer errors.

### Composition guard

The existing composing-owner early return remains at `renderer.ts:348-355`.
The new unit regression at `packages/core/src/foundation/phase2_5.test.ts:254-275`
moves a sibling while `p0` is composing and asserts both DOM identity and
`composingDomWriteCount === 0`. It passed with the full core suite. The browser
composition case passed in Chromium, Firefox, and WebKit (6/6 when combined
with the list-Enter case). No physical-device IME claim is made here.

## 2. Duplicate-typing repro

The exact rapid path is now covered at
`packages/react/e2e/canonical-authority.spec.ts:677-707`:

- canonical authority enabled;
- caret placed in a known block;
- twelve alternating Move Down/Move Up operations;
- a unique text token typed immediately after every move, with no delay;
- model inspection verifies every token occurs exactly once and remains in the
  originally selected block.

Result: **3/3 browsers passed**. I also reran the existing repeated-move/type
coverage in the same browser session. The historical duplicate-character
symptom did not reproduce, including rapid alternating moves and immediate
typing. This is evidence against a remaining duplicate insertion, not a claim
that every unrecorded timing sequence has been exhaustively reproduced.

## 3. Table row/column reorder

The defect is generic to stable-ID sibling reconciliation, not to block moves.
The targeted test at `packages/react/e2e/canonical-authority.spec.ts:751-849`
does both operations:

- move a table row, then assert model owner ID and native DOM owner ID remain
  equal and type into the cell;
- move a table column, repeat the owner checks, and type into the cell;
- assert each inserted token occurs exactly once in the table model.

Result: **6/6 browser cases passed** (Chromium, Firefox, WebKit). No
table-specific renderer patch was needed; the stable-ID path at
`renderer.ts:383-407` covers rows and columns as well as blocks and list items.

## 4. Suite accounting

| Suite | Before this follow-up | After this follow-up |
|---|---|---|
| Core Vitest | 51 files / 441 passed | **51 files / 442 passed**; the new composing-sibling test is included |
| React Vitest | 43 files / 240 passed | **43 files / 240 passed** |
| Playwright | Latest completed full run: 282 scheduled, 264 passed, 13 failed, 5 skipped | **294 discovered**. A full 294-case run was not claimed; the exact 12-case matrix was 6 passed / 6 pre-existing failures, composition+Enter was 6/6, and move/table was 6/6 |

No test was removed. The current browser discovery count includes the
uncommitted follow-up scenarios; focused runs were used rather than presenting
the partial full-suite result as green. `git diff --check`, core lint, React
lint, and the full core suite passed. No recurring WebKit failure occurred in
the focused runs; the prior full-suite WebKit contention issue remains tracked
separately.

## Disposition

The renderer fix is now generic, composition-safe under the automated
contract, and verified for block/list/table reorder. The six disabled-resize
failures remain open pre-existing product/test-harness issues, and the complete
294-case browser suite still needs a clean run before any promotion decision.
The canonical flag was not promoted and no rollback bridge was deleted.
