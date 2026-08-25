# Smart RTE — Revised Phase Map (8b → 12b)

**Revised:** 2026-08-06
**Why revised:** the product is now a distributable editor rather than infrastructure for Sootr alone, and real-time collaboration moved from "contract-gated, may never happen" to "later, but the architecture must accommodate it."

**Supersedes:** the "Phase 12" collaboration framing in `docs/PHASE12_TRANSACTION_VALIDITY_DEBT.md` (which bundled per-transaction validity and collaboration into one future phase), as of 2026-08-06. Per-transaction validity is now Phase 8c item 1; collaboration is split into Phase 12a (versioning/async review, v1.1) and Phase 12b (real-time collaboration, v2). `PHASE12_TRANSACTION_VALIDITY_DEBT.md` carries a pointer back to this document. The vestigial "Collaborative editing" bullet in `README.md`'s roadmap section predates all of this and should be read as superseded too, though it was never phase-numbered.

---

## 0. What changed and what follows from it

| Decision | Consequence |
|---|---|
| Distributable product | Format code must move into `packages/core`; public API, semver, and publish policy become real deliverables |
| Collaboration later, space reserved now | The one broken prerequisite (granular table operations) must be fixed **before** a plugin API freezes the current invariants |
| Media across S3 / Azure / GCS / R2 | One host-implemented storage interface, zero cloud SDKs in the package |
| KaTeX required | Real dependency, not a `window` global; MathML output verified for accessibility |
| Docs later, if features are organised | Phase 10's plugin manifest carries doc metadata so docs are largely generated, not written |

**Ship points:** v1.0 at the end of Phase 11. Versioning and asynchronous review (12a) is v1.1. Real-time collaboration (12b) is v2.

---

## Still open: Phase 8b completion

Not a new phase — the remaining work before promotion:

- Toolbar parity: the ten "present but unrouted" capabilities, of which the **media-manager workflow** is the substantive one (currently `window.prompt`)
- Session replay expanded to generated multi-command sessions with selection comparison
- The five broken gate scripts fixed or retired; `pnpm run lint` green; `check-phase8b-contract.mjs` wired into `scripts`
- The five undocumented commits accounted for
- Flag promotion, then deletion of the four rollback bridges

---

## Phase 8c — Collaboration Readiness *(new)*

**Purpose:** make "space for collaboration" a verified property rather than an intention. Everything here is cheap now and expensive after Phase 10 exposes a plugin API.

**Contents:**

1. **Per-transaction validity model.** Operations within a transaction may pass through invalid intermediate states; schema and geometry are asserted at commit. This is the Phase 1 contract change that unblocks item 2.
2. **Fine-grained table operations.** Replace the whole-table `replaceNode` in 10 of 14 table commands with cell-level operations. Two users editing different cells must produce composable transactions. Side benefit: history entries stop costing ~1.6 MB, so the 32 MB budget stops silently capping table-heavy undo at ~20 steps.
3. **Annotation range primitive.** A range anchored to node IDs that maps through transactions and survives structural edits. The *primitive* only — comments and suggestions are 12a. Adding it here is nearly free while the validity model is already open.
4. **Rollback preserves node identity.** Phase 8b §E4 remints IDs through the clean-HTML boundary; once annotations exist that's data loss.
5. **The collab-readiness gate** (below), running every phase from here on.

**Exit:** all six readiness assertions pass; full Phase 1 property suite re-run against the new validity model; table history entry size measured and reported.

### The collab-readiness gate

Six machine-checked assertions, run in CI every phase. Without this, reserved space erodes silently — exactly how five gate scripts rotted around a marker nobody was checking.

1. Node identity survives split, merge, move, type change, and undo
2. Every operation is granular — no operation replaces a subtree larger than the edit requires
3. Selection maps through every operation type, associatively
4. Transactions are JSON-serializable and carry `baseRevision` and `authorId`
5. Every operation implements `map(op, otherOp)`
6. Annotation ranges survive arbitrary transaction sequences

---

## Phase 9 — Format Codecs and Package Boundary

**Purpose:** consolidate serialization behind per-feature codecs, and make `smartrte-core` actually deliver what its description claims.

**Contents:**

- **Relocate** `docxFormat`, `styledDocxFormat`, `portableDocxAtoms`, `pdfFormat`, `pdfImport` from `packages/react/src/adapters/` into core, framework-agnostic. Today a non-React consumer of core has no import/export path at all.
- **Break up** the monolithic `serializeBlock` if-chain into codec-per-feature.
- **`FeatureFormatCodec`** per plugin: `parse` / `serialize` / `fallback` / `fidelity: full | semantic | lossy | unsupported`, with round-trip fixtures backing every fidelity claim.
- **Public API surface**: what core exports, what `/foundation` exports, what `/legacy` exports, and a headless facade (create, destroy, dispatch, subscribe, register) so non-React integration is possible.
- **KaTeX** as a declared dependency; remove `window.katex`; verify MathML output is emitted (this may resolve the Phase 7 §E3 LaTeX-read-aloud defect as a config fix rather than a project).
- **Semver, changelog, and publish policy.** The rebuild is a major break from the published `main`-branch versions. Decide the version, the pre-release channel, and the "do not publish until" line.

**Exit:** core builds and serializes every format with no React import; every fidelity claim has fixtures; the headless facade is exercised by a non-React test.

---

## Phase 10 — Plugin Ownership and Extension Points

**Purpose:** turn seventeen built-in feature families into declared plugins, and define the extension points a distributable editor needs.

**Contents:**

- **Plugin manifest**: `id`, `dependencies`, `schema`, `scopeResolvers`, `commands`, `normalizers`, `inputRules`, `keyboardShortcuts`, `clipboard`, `renderer`, `toolbar`, `contextMenu`, `formats`.
- **Doc metadata in the manifest** — `description`, `examples`, and typed options on every command and option. This is what makes "docs later" cheap: they're generated from declarations rather than written and separately maintained.
- **Storage / media interface**, host-implemented:
  ```ts
  interface MediaProvider {
    upload(file: File, opts): Promise<{ url: string; id: string }>;
    search(query: string, filters, page): Promise<MediaItem[]>;
    remove(id: string): Promise<void>;
  }
  ```
  **Zero cloud SDKs ship in the package.** Production uploads go through the host's backend with presigned URLs; the editor never holds bucket credentials. S3/Azure/GCS/R2 adapters, if wanted, are optional side packages. Sootr's implementation is the reference.
- **Media picker UI** as a replaceable component, with a default implementation.
- **Conflict resolution**: duplicate command IDs, shortcut collisions (Tab is already contested by lists, tables, and code blocks), normalizer ordering, renderer and clipboard priority, dependency cycles.
- **Disable safety**: removing a plugin removes its UI and commands, preserves existing content as `unknown`, and fails loudly on missing dependencies.

**Exit:** every built-in is a plugin; a third-party plugin can be written against the public manifest without editing core; disabling any plugin loses no data.

**Status (2026-08-18): complete.** Two follow-ups flagged at closeout were carried into Phase 11 Tier 0 as stop-condition items and are now both fixed (2026-08-19):
- `docs/bugs/input-ts-not-wired-to-plugin-shortcut-dispatch.md` — `resolveShortcut` was built and tested but never actually called by `surface/input.ts`; investigation found the fix needed real registered shortcut contributions and fallback dispatch semantics (ScopeKind alone can't distinguish a code block from a plain paragraph), not just a mechanical rewire. Fixed: `input.ts`'s Tab handler now calls `resolveShortcut` for real, verified with a synthetic third-party-plugin shortcut test and a clean full 3-browser e2e run.
- `docs/bugs/plugin-disable-marks-is-lossy.md` — re-scoped 2026-08-19 to a general `repair()` limitation reachable on any ordinary document load, then fixed the same day via a mark-side `unknown-mark` sentinel mirroring the existing node-side `unknown` mechanism.

---

## Phase 11 — Production Hardening → **v1.0**

**Purpose:** everything deferred, plus the evidence a distributable product needs.

**Contents:**

- **The manual debts**, now blocking rather than deferrable: NVDA + Chrome (including table-mode navigation), physical-device IME (Gboard Hindi/Tamil, Safari Indic, CJK), native Word for Windows clipboard capture, server-side upload MIME validation.
- **Performance**, measured against *real* documents — a genuine Sootr study guide, not 10,000 synthetic blocks. The original complaint that triggered this rebuild was unresponsiveness; this is where that claim gets closed.
- **`content-visibility`, renderer-integrated.** The naive per-block experiment measured 55–699 ms against a 41–46 ms baseline and is disproven; any design here must be renderer-aware or the idea is dropped.
- **Clipboard corpus expansion** beyond the current eight captures, plus the privacy-safe paste-failure diagnostic that would let production failures grow it.
- **Security review** across the full surface; live CVE check against resolved dependency versions.
- **Twelve scenario layers per feature**, three browsers, plus a11y and i18n passes.

**Exit:** v1.0 ships.

**Status (2026-08-19): all automatable items complete** (`docs/PHASE_11_COMPLETION_REPORT.md`). Table Tab/Shift-Arrow navigation was built (found to be a missing feature, not just a missing test); marks/blocks DOCX codec slice wired; `content-visibility` implemented, benchmarked, and rejected (does not beat baseline, kept opt-in/off, documented); security review run for the first time (one real fix: `underscore` via mammoth); paste-failure diagnostic confirmed already wired; 3 new accessibility-scanned surfaces found and fixed 2 real bugs.

**Four items explicitly waived by the product owner, 2026-08-19**, rather than resolved: NVDA+Chrome screen-reader validation, physical-device IME testing, a native Windows Word clipboard capture, and real-document performance validation. These remain genuinely untested/unvalidated — the waiver is a deliberate decision to ship v1.0 without them, not evidence they're fine. If any of the four surfaces a real production issue later, that is a known, accepted risk at this decision point, not a surprise. **Phase 11 is now closed; v1.0 may ship; Phase 11.5's gate 1 is satisfied.**

---

## Phase 11.5 — Editor Interaction Surface

**Purpose:** close the gap between what the command layer already supports and what the UI actually exposes — media management, table interaction, context menus, color picking, and link editing.

**Contents:** media manager UI (upload/library/duplicate-detection/per-asset metadata), advanced table interaction UI (click-to-edit, row/column reorder, resize), right-click context menus dispatching to existing commands, a real color picker replacing `window.prompt`, and inline link editing. Explicitly out of scope: `MediaProvider` redesign unless proven necessary, new storage backends, real-time collab UI, unshipped Phase 11 scope.

**Exit:** all five work items closed against existing commands, with zero cloud SDK/storage-specific code added.

**Status (2026-08-19): complete** (`docs/PHASE_11_5_COMPLETION_REPORT.md`). §1.1's pre-work investigation (`docs/PHASE_11_5_MEDIAPROVIDER_FINDINGS.md`) found two of the five work items already had fully built, unwired UI components (`MediaManager.tsx`, `LinkEditorPopover.tsx`) — the same "real code, never connected" pattern found repeatedly elsewhere in this project — reshaping the real scope to two wiring tasks plus three genuine new builds (color picker, table interaction, context menus). Two real bugs found and fixed along the way (table `columnWidths` never rendered; that fix's own `:first-child` selector regression). `contextMenu` plugin-registry contributions (previously a manifest field with zero built-in plugins populating it) now populated for marks/table/atom, dispatched the same way `keyboardShortcuts` already are. Full 3-browser e2e: 253 → 299 passed / 7 skipped / 0 failed across the phase; core 607/607; react 96/96; lint clean.

---

## Phase 12a — Versioning and Asynchronous Review → **v1.1**

**Purpose:** most of the collaboration value, none of the distributed-systems cost. No transport, no server, no presence.

**Contents:**

- **Versioning**: document snapshots, diff between versions, restore. Rests on stable identity and serializable transactions — both already in place.
- **Comments** anchored to the 8c annotation ranges.
- **Suggestions / track changes**, asynchronous: authorship from transaction metadata, accept/reject, suggestion-mode editing.
- **Diff rendering** — a document-level structural diff, which versioning and suggestions both need.

**Why this is separable:** everything here is single-writer. It's the half that matters most for study-guide authoring and review, and it's weeks of work rather than quarters.

**Status (2026-08-25): complete.** §1 pre-work found the Phase 8c `AnnotationRange`/`MergeOrphanPolicy` primitive had zero real consumers and, critically, that the only real `mergeNode`-emitting site (`queueRangeDeletion`, cross-block selection deletion) does **not** cover the two other real "merge" shapes already in the codebase — table-cell-merge and list-item-merge, both `replaceNode`/`removeNode`-based with no orphan lever at all. Fixed via optional `mergedInto`/`retiredInto` fields on those operations (snap-to-survivor, not drop) rather than a new `SmartOperation` variant, to avoid `invertOperation`/`mapOperation`'s unsafe fallback branches. **Diff engine**: ID-keyed structural diff + word-level LCS text diff, shared by versioning and (eventually) suggestions rendering. **Versioning**: snapshot/restore/diff, `VersionProvider` host boundary mirroring `MediaProvider`; restore is non-destructive (records a new forward version rather than rewriting history), revision always re-stamped to `current + 1`. **Comments**: `AnnotationRange`-anchored threads, `CommentProvider` host boundary, live markers following `TableResizeHandles`' measure-and-observe pattern (§1.2 found the other overlay components are single-instance and don't generalize to many simultaneous anchors). Comments' own e2e anchor-survival test caught a **third**, more consequential merge-orphan gap: `surface/input.ts`'s `deleteAcrossBlock` (a *collapsed-caret* Backspace/Delete at a block boundary — the single most common real "merge two paragraphs" interaction) also builds a bare `replaceNode`/`removeNode` pair with no `mergedInto`, silently dropping any comment anchored to the removed side. Fixed the same way (`docs/bugs/comment-lost-on-cross-block-backspace-merge.md`); a full sweep of every remaining `removeNode`/`replaceNode` site (clipboard paste/cut splicing, list/block wrap-unwrap, ~40 call sites) was explicitly **not** performed and is logged as a known, named gap in that same file. **Suggestions/track changes**: architecture fork (marks-only vs. AnnotationRange+deferred-operations vs. hybrid) presented to the product owner rather than resolved silently, per the spec's own instruction; hybrid chosen (2026-08-24) — inline insert/delete is a real "suggestion" mark on real, live text (reuses the entire marks pipeline for free: split/merge/undo/rendering), structural whole-node removal reuses the same AnnotationRange+live-overlay pattern just proven for comments. First cut shipped with two deferred gaps, both named explicitly rather than silently under-scoped: (1) no ambient track-changes mode — suggesting was only reachable via explicit toolbar actions — and (2) structural *insertion* suggestions (only structural *removal* is supported). On review (2026-08-25), gap (1) was judged load-bearing rather than a follow-up nicety (manual per-action tagging is not what "track changes" means to anyone familiar with Word/Google Docs' suggesting mode) and was built the same day: `surface/input.ts`'s `replaceSelection`/`deleteRange` now check a `setTrackChanges(enabled, authorId)` flag on the input pipeline and redirect ordinary typing/same-owner Backspace-Delete to live suggestion marks instead of editing directly, exposed as a "Track changes" toolbar toggle. Deliberately scoped out even with the mode on: a selection crossing multiple paragraphs, and the cross-block Backspace/Delete merge (`deleteAcrossBlock`) — both still edit directly. Gap (2) (structural insertion) and the ~40-site `removeNode`/`replaceNode` audit gap from the comments work remain open, deferred on the "revisit on a real report" trigger rather than "revisit before real usage" — a distinction made explicitly, not assumed. **Diff rendering**: textual diff summary shipped for versioning; full inline colored-diff rendering (the surface versioning and suggestions were meant to share) was not built. This is not an oversight — the hybrid architecture's marks-based inline suggestions are their own diff (rendered live, no computation needed), which is precisely what made the shared diff-rendering surface unnecessary for suggestions; that would not change even with gap (2)'s ambient interception, since ambient tagging still produces live marks, not deferred operations requiring a synthesized preview. Verification throughout: core 693/693, react 130/130, lint clean; comments and suggestions e2e specs (including the ambient-mode test) each stable across 3 runs × 3 browsers; full e2e suite 145/146 passed with zero regressions from the `surface/input.ts` change (1 unrelated pre-existing perf-benchmark skip; one drag-resize test flaked once and passed clean in isolation, a known-flaky timing test unrelated to this phase).

---

## Phase 12b — Real-Time Collaboration → **v2**

**Purpose:** multi-writer, and honestly the largest single item on this map — comparable in effort to Phases 1–11 combined.

**Contents:** OT vs CRDT decision, transaction transport, a server component, rebasing (`baseRevision` stops throwing and starts rebasing), presence, remote cursors, offline and reconnect, conflict UX.

**Prerequisites:** all six collab-readiness assertions green and having stayed green since 8c.

**Note honestly:** this is a distributed systems project with a backend, not more editor work. The agent-driven loop that has worked well through eight phases works considerably less well when correctness depends on network timing and server state. Plan for it differently, and don't let v1 wait on it.

---

## Sequencing summary

```
8b completion → 8c (collab readiness) → 9 (formats + package boundary)
              → 10 (plugins + extension points) → 11 (hardening) ─────→ v1.0
              → 12a (versioning + async review) ────────────────────→ v1.1
              → 12b (real-time collaboration) ─────────────────────→ v2
```

**Non-negotiable ordering:** 8c precedes 10. Once a plugin API is published, the per-operation validity invariant and the coarse table operations become things third parties depend on, and changing them stops being a refactor and becomes a coordinated migration.

Everything else can move if priorities change.
