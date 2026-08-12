# Handoff: Phase 8b closeout status (2026-08-11)

**Purpose of this document:** a self-contained briefing for whichever Claude session picks this up next. Assumes zero prior context. This supersedes `docs/HANDOFF_2026-08-10_LIST_TOOLBAR.md` for current status — that document is still useful for its detailed account of the individual list-toolbar bugs it covers, but its "repo state" and "next steps" sections are stale as of this file.

**Read this first, every time, before investigating anything:** `CLAUDE.md` at the repo root has a standing rule — check `docs/bugs/` before investigating any reported bug. It's a 57-file ledger (one file per distinct issue, `docs/bugs/README.md` documents the format) covering this project's full bug-hunt history, including several multi-round arcs where something was fixed, reopened, or turned out to be a stale-build artifact rather than a real regression. Skipping this check has cost real time more than once in this project's history — that's why the rule exists.

## 0. Where this fits

1. `docs/PHASE_1_8B_INDEPENDENT_AUDIT.md` (+ `§7` addendum) — the independent source audit that started this thread. Found `pnpm run lint` failing on a clean tree, among other things. **That specific finding is now resolved — see §2.**
2. `docs/PHASE_ROADMAP_8B_12B.md` — the phase plan (8b → 12b). Smart RTE is a distributable product, already published on the public npm registry.
3. `docs/HANDOFF_2026-08-10_LIST_TOOLBAR.md` — yesterday's handoff, detailed bug-by-bug account of the list-toolbar work.
4. `docs/bugs/` + `CLAUDE.md` — the permanent bug ledger and its standing check-first rule, built since yesterday's handoff (see §3).
5. This document — today's status, written specifically to support the Phase 8b promotion decision.

**Repo orientation unchanged from the last handoff:** `packages/core` = `smartrte-core`, `packages/react` = `smartrte-react`. Canonical toolbar is `packages/react/src/components/CanonicalAuthorityEditor.tsx`, gated behind `canonicalAuthorityFlag` which **defaults to off** — unconfigured consumers get the legacy `ClassicEditor.tsx`. Dev server: `pnpm --filter smartrte-react run dev`, playground aliases live source (not `dist`) across all four relevant import paths — confirmed exhaustively, not just spot-checked.

## 1. What changed since yesterday's handoff

- **Three more real bugs found and fixed**, from user-reported screenshots, in `packages/core/src/foundation/list/commands.ts` and `packages/core/src/foundation/surface/input.ts`:
  - `indentList` dragged an indented item's own nested children one level deeper along with it, instead of hoisting them to siblings at the item's new position. Fixed via a new `flattenMovedItem` helper.
  - `unwrapOne`, when splitting an ordered list around a middle unwrap point, never gave the trailing portion a continuing `start` — it silently restarted numbering at 1. Fixed.
  - The Tab keydown handler only called `preventDefault()` after confirming indent/outdent had something to do. When they correctly declined (e.g. cursor on a list's first item, nothing to nest under), the browser's native Tab took over and **moved keyboard focus out of the editor entirely**. Fixed — Tab is now absorbed unconditionally whenever the cursor is in a list item outside a table.
  - Full detail, reproduction, and regression coverage for all three: `docs/bugs/indent-drags-whole-subtree-instead-of-hoisting-children.md`, `docs/bugs/list-split-numbering-restarts-instead-of-continuing.md`, `docs/bugs/tab-key-loses-editor-focus-when-indent-declines.md`.
- **The `docs/bugs/` ledger was built from scratch and is now the canonical bug history for this project.** Backfilled from the `docs/PHASE_8B_*.md` report corpus (research delegated to parallel agents, since it's ~160KB across 18 files) plus this session's own fixes, then independently reviewed and substantially extended by the Codex session that did much of the underlying implementation work — Codex corrected at least one status (the WebKit full-suite flake, see below) and added roughly a dozen entries this session had no visibility into (e.g. `rollback-edit-remints-node-ids`, `production-input-to-paint-10k-exceeds-budget`, `native-windows-word-clipboard-capture-gap`, `link-toolbar-editing-route`, `media-atoms-not-rendered-or-playable`, `canonical-editor-root-padding-missing`, `cell-selection-demoted-by-selectionchange`, `empty-line-caret-not-visible-after-enter`, `nested-list-in-table-cell-not-reproducible`). Read those directly if working in any of those areas — they aren't summarized further here.
- **`pnpm run lint` is fully green** — every gate script (foundation-boundary, scope-contract, phase2.5/3/4/6/7/8a/8b-contract) plus both packages' `tsc --noEmit`. This is the specific thing `docs/PHASE_1_8B_INDEPENDENT_AUDIT.md` originally found broken (a `MIGRATION_ADAPTER` marker-census gate rot). **That finding is now closed** — confirmed by directly running `pnpm run lint`, not inferred.
- **The WebKit full-suite timeout flake was actually root-caused**, not just observed clean. It was a harness readiness/focus race — the affected e2e test pressed Enter immediately after `page.goto` before the React harness had mounted/focused the canonical surface, so Enter went to the page instead of the seeded list. Fixed by waiting for `window.__smartCanonical`, waiting for visibility, and explicitly focusing before the first keystroke. This had been carried as "Needs re-verification" / "resource contention, never root-caused" across four prior status reports — see `docs/bugs/webkit-full-suite-timeout-flake.md` for the full arc.
- **Two commits landed**, both authored this session with explicit user approval before committing:
  - `4fa6464` — the three list-toolbar fixes above.
  - `12d799c` — the `docs/bugs/` ledger + `CLAUDE.md`.
- **Working tree is fully clean** as of this writing (`git status --short` empty).

## 2. Current verified state

Checked directly, all in the same session as this writing:

| Check | Result |
|---|---|
| `pnpm run lint` | Clean — every gate script + both packages' `tsc --noEmit` |
| Core unit tests | 461/461 passed |
| React unit tests | 240/240 passed |
| Full e2e suite (`canonical-authority.spec.ts` + `canonical-toolbar-routing.spec.ts`, Chromium) | 55/55 passed, 0 failures — including tests that were flaky as recently as two sessions ago |
| Uncommitted files | 0 |

## 3. Bug ledger snapshot (57 files, `docs/bugs/`)

As of the last time this session counted (immediately before Codex's final extension pass — re-count with `ls docs/bugs/*.md | wc -l` if precision matters, since Codex may have kept adding):

| Status | Count (approximate, pre-final-extension) |
|---|---|
| Fixed | ~39+ |
| Not a bug | ~7 |
| Needs re-verification | ~5 |
| Open | ~4 |

**Do not trust these counts** — grep `docs/bugs/*.md` for `**Status:** Open` and `**Status:** Needs re-verification` directly for the current, authoritative list. Two specifically worth knowing about without re-deriving them:

- `docs/bugs/unwraplist-deepest-first-gap-multi-depth-toggle-off.md` — **Open, deliberately deferred.** `unwrapList` only unwraps items that are direct children of the list it resolves to; a selection spanning multiple nesting depths silently leaves deeper items nested. A real fix needs a "process deepest-first against a progressively-updated document" pattern with no precedent elsewhere in this command layer — flagged in the file itself as worth scoping together with Phase 8c/10's fine-grained table operations, which likely need the same capability.
- `docs/bugs/double-enter-list-exit-not-reproducible.md` and `docs/bugs/mixed-depth-select-retype-stray-numbering-not-reproducible.md` — both **Needs re-verification**, both investigated with multiple faithful reproduction attempts against live source, neither reproduced. Standing ask if either resurfaces: get an exported document JSON or exact click sequence, not another text description — guessing at the repro has failed twice already for these two.

## 4. Phase 8b closeout plan — status against the plan the user laid out

(Full plan text isn't reproduced here; ask the user for it if it's not in your context, or infer from this table.)

| Step | Status |
|---|---|
| 0 — Fix stale-build gap | Closed. |
| 1 — Re-verify the 2 non-repros | Ledger entries exist; still needs the user's manual confirmation. |
| 2 — Confirm mixed-scope Indent/Outdent fix | Ledger entry exists (Fixed, with coverage); still needs the user's manual confirmation against their exact original screenshots. |
| 3 — Collect dropdown-sync report | Done. |
| 4 — Decide on `unwrapList` deepest-first + marker-cascade test | Marker-cascade coverage: done. `unwrapList` fix: still needs a user yes/no — not done, not started, deliberately waiting. |
| 5 — Commit review pass | Done — tree is clean (§2). |
| 6 — Fix atom-resize + flake, run clean full suite | Done, verified (§2). |
| 7 — **Promotion decision** | **The actual remaining gate.** Last known state (per a Codex status report this session did not independently re-verify): Gate 13 covers all 42 comparable intents; Gate 14 still has 11 classified divergences needing owner disposition. This is a product/ownership call, not a technical blocker — nothing here should be resolved by an agent unilaterally. |
| 8 — Start Phase 8c | Blocked only on Step 7. |

## 5. Suggested framing for next steps

1. **Steps 1, 2, and 4 need the user, not more engineering.** They're waiting on manual confirmation and one scoping decision, not unresolved technical work.
2. **Step 7 (promotion) needs someone to look at Gate 14's 11 divergences and decide.** Re-verify their current count/nature before deciding anything — this handoff doc inherited that number from a prior status report, not a fresh check.
3. **Once Step 7 resolves**, Phase 8c is fully scoped already in `docs/PHASE_ROADMAP_8B_12B.md` — per-transaction validity, fine-grained table operations (worth scoping alongside `unwrapList`'s deferred fix, per §3), an annotation-range primitive, rollback ID-preservation, and the six-assertion collab-readiness gate.
4. **Read `docs/bugs/` before touching anything new.** That's not a suggestion, it's the standing rule in `CLAUDE.md`.
