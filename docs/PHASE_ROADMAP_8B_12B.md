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

---

## Phase 12a — Versioning and Asynchronous Review → **v1.1**

**Purpose:** most of the collaboration value, none of the distributed-systems cost. No transport, no server, no presence.

**Contents:**

- **Versioning**: document snapshots, diff between versions, restore. Rests on stable identity and serializable transactions — both already in place.
- **Comments** anchored to the 8c annotation ranges.
- **Suggestions / track changes**, asynchronous: authorship from transaction metadata, accept/reject, suggestion-mode editing.
- **Diff rendering** — a document-level structural diff, which versioning and suggestions both need.

**Why this is separable:** everything here is single-writer. It's the half that matters most for study-guide authoring and review, and it's weeks of work rather than quarters.

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
