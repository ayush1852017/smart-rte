# Phase 8b Canonical Authority Takeover — Delta Report 2

Date: 2026-08-06  
Scope: work-order items 1–6; gates 12–14 and 16

## Verdict

The requested remediation work is implemented and committed, but promotion is
still **HOLD**.

- Gate 12 passes under the corrected rollout definition: no rollback bridge is
  reachable from the canonical product graph. Four rollback bridges remain by
  design and are not deleted in this report.
- Gate 13 has materially stronger evidence: five generated sessions cover 49
  migrated command intents, and model-level semantic selection is compared at
  all 49 comparable checkpoints in Chromium, Firefox, and WebKit. The original
  retained-versus-canonical trajectory also remains at zero divergence. The
  literal gate is still qualified because the generated complete sessions run
  twice through the canonical product surface; the retained legacy engine does
  not expose an equivalent route for every new parity command/provider flow.
- Gate 14 is therefore not promoted to an unconditional pass. The nine
  requested parity families are now routed, with no observed difference in the
  retained 11-intent trajectory, but the complete dual-engine all-command
  comparison is not proven.
- Gate 16 passes: core 423/423, React 235/235, and the three-browser suite
  235 passed with 5 intentional skips out of 240 tests. No test was removed.

The authority flag remains off by default. No rollback bridge was deleted.

## Work-order accounting

### Item 1 — contract scripts and enforcement

The five stale scripts were rebuilt in `61b653f`, not marker-renamed. The
shared helper is `scripts/contract-utils.mjs`; it strips comments before source
shape checks and provides the common failure/reporting path. The Phase 8b gate
was added to the root lint chain and the same lint command is now run in
`.github/workflows/quality.yml` on pushes and pull requests. The retained
clipboard bridge marker and inventory were corrected in `2f86482`; the Phase
8b positive source checks were made comment-resistant in `b1d26f8`.

| Script | What it asserted before | What it asserts now | Can a comment alone satisfy it? |
|---|---|---|---|
| `scripts/check-phase3-contract.mjs` | Pure signature and command names, legacy/list route strings, root/legacy exports, documentation policy, and a `MIGRATION_ADAPTER` marker count. Several checks were documentation or marker presence. | Comment-stripped `ListCommand` purity; no DOM/editor authority imports; all 10 mapped list commands; actual canonical command calls; legacy mutation-pattern absence; normalized shadow helpers; retained harness; root and legacy exports. | No. Source is comment-stripped and checks are tied to executable shapes. |
| `scripts/check-phase4-contract.mjs` | 12 declaration strings, legacy import/`execCommand` patterns, and exactly three adapter marker strings. | Exactly 12 declarations; all five generic mark command entries and implementations; no Classic inline `execCommand`; canonical `executeMarkTool` routing; retained legacy harness. | No. Source is comment-stripped; marker counting is gone. |
| `scripts/check-phase6-contract.mjs` | Resolver string, 14 command strings, direct DOM mutation pattern, retained harness, catalogue text, and three marker strings. | One exported `occupancyGridFor` consumed by both resolver and commands; all 14 mapped table commands; no Classic table DOM mutation; canonical table routing; retained harness. | No. The checks inspect imports, exports, maps, and forbidden source patterns. |
| `scripts/check-phase7-contract.mjs` | Atom specs/command strings, URL/security/lifecycle text, unsafe-rendering patterns, legacy fallback text, plan text, and three marker strings. | Six atom specs; four generic atom commands; shared URL policy with no second `URL` policy; async non-history/stale-ID handling; persistence guards; unsafe DOM/evaluation rejection; read-only atom renderer; atom-token composition; canonical route; retained harness. | No. Positive checks use comment-stripped source and marker counting was removed. |
| `scripts/check-phase8a-contract.mjs` | Sanitize-before-normalize and DOMPurify checks, Classic clipboard patterns, canonical paste listener, retained harness, 3+1 marker accounting, and diagnostic strings. | Structural sanitize-before-normalize ordering; DOMPurify/shared URL policy/no second URL policy; no Classic clipboard handling; canonical runtime boundary; retained cleaner; privacy-safe diagnostics; no executable clipboard `execCommand`. | No. The source checks are comment-stripped and the marker count was retired. |
| `scripts/check-phase8b-contract.mjs` | It existed but was not invoked by `package.json`; its source checks were not comment-stripped. | Repository executable `execCommand` scan (excluding only docs and the script itself); forbidden authority markers on product paths; runtime flag; explicit replacement/checkpoint ownership. Positive source checks now strip comments; forbidden-token scans fail on source text rather than being satisfied by a comment. | No for the positive checks; a forbidden token in a source comment still fails the literal repository scan. |

`pnpm run lint` now passes all contract gates and both package TypeScript lints.

### Item 2 — post-report commit accounting

The work order refers to five undocumented commits, but the repository contains
**six** commits after the prior delta report. All six are accounted for here:

| Commit | Change | Belongs in this delta? |
|---|---|---|
| `a174092` | Repaired canonical editing interactions: selection preservation, table/caret handling, media rendering/routing, toolbar interaction fixes, and browser coverage. | Yes; it is the first repair of the reported media/caret/parity gaps. |
| `d4a082e` | Added canonical cell-selection input/renderer handling and media insertion support, with browser coverage. | Yes; it closes the previously reported cell/media routing failures. |
| `8a56c73` | Restored caret placement after tables and rendered media nodes; added atom regression coverage. | Yes; it directly addresses the reported post-table and media rendering failures. |
| `608c910` | Snapped cell selections to valid spans, improved renderer behavior, and added media diagnostics/browser coverage. | Yes; it addresses vertical/merged-cell selection and media diagnosis. |
| `0bad685` | Changed direct media prompt wording to require a direct resource URL rather than a page. Despite the commit message saying “docs,” the diff is a product-source prompt change. | Yes; it explains the reported media URL behavior and must not be omitted from the audit trail. |
| `38ee499` | Restored a legal editable caret line after block atoms and added input/renderer/browser tests. | Yes; it addresses the reported inability to move below image/audio/video. |

The six commits moved the core unit count from 420 to 423. React remained at
235 tests. No test deletion was found.

### Work-order commits

| Commit | Work-order item |
|---|---|
| `61b653f` | Rebuilt the five contract scripts, added `contract-utils`, wired Phase 8b lint, and added CI lint enforcement. |
| `9ed4fd6` | Defined `MediaProvider`, added the replaceable/default picker, and routed pending/async media insertion. |
| `df60f96` | Routed the nine requested parity workflows without adding command semantics. |
| `b430a4c` | Added generated five-session/49-intent replay with model semantic-selection checkpoints; fixed the strikethrough declaration label. |
| `2f86482` | Marked the fourth retained clipboard rollback bridge and corrected the inventory. |
| `b1d26f8` | Made the Phase 8b positive source checks comment-resistant. |

## A. Implemented interfaces and routing surface

### Host-owned media boundary

Actual final TypeScript from `packages/react/src/mediaProvider.ts`:

```ts
export type MediaKind = "image" | "video" | "audio";

export interface UploadOptions {
  readonly signal?: AbortSignal;
}

export interface MediaFilters {
  readonly mimePrefix?: string;
  readonly tags?: readonly string[];
  readonly hashHex?: string;
  readonly pageSize?: number;
}

export interface MediaItem {
  readonly id: string;
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly sizeBytes?: number;
  readonly mimeType?: string;
  readonly hashHex?: string;
  readonly createdAt?: string;
  readonly title?: string;
  readonly alt?: string;
  readonly tags?: readonly string[];
  readonly license?: {
    readonly author?: string;
    readonly licenseType?: string;
    readonly licenseText?: string;
    readonly sourceUrl?: string;
    readonly workName?: string;
  };
}

/** Host-owned media boundary. The editor never receives storage credentials. */
export interface MediaProvider {
  upload(file: File, opts?: UploadOptions): Promise<{ url: string; id: string }>;
  search(query: string, filters?: MediaFilters, page?: number): Promise<MediaItem[]>;
  remove(id: string): Promise<void>;
}
```

`CanonicalAuthorityEditor` accepts `mediaProvider?: MediaProvider` and a
replaceable `mediaPicker?: MediaPickerComponent`. The default picker only
selects a local file; the playground supplies the sole in-repository reference
provider. There are no cloud SDKs or bucket credentials in the package.

### Operation routing options

The existing runtime interface was extended, without changing command purity:

```ts
export interface ExecuteOperationsOptions {
  historyGroup?: string;
  addToHistory?: boolean;
  preserveSelectionById?: boolean;
  selectionOwnerId?: string;
  selectionOffset?: number;
}
```

Media insertion creates a pending atom, calls `MediaProvider.upload` outside a
transaction, then completes it through the Phase 7 atom lifecycle with
`addToHistory: false`. A completion is dropped if the node ID no longer exists;
the preview blob URL is revoked and is never persisted as a ready value.

### Parity routes

The following now call existing foundation commands/declarations; no new mark
or block semantics were added:

- attributed marks: font family, font size, foreground colour, background
  colour, through `executeMarkTool` and the existing generic declarations;
- blockquote toggle, block move, block indent, block outdent;
- list preset selection;
- DOCX import/export and PDF import/export workflows;
- the existing list/table/atom/link routes remain active and covered by the
  expanded browser suite.

### Replay checkpoint

`packages/react/e2e/canonical-authority.spec.ts` records both normalized
ID-stripped structure and model semantic selection. Each model point is
represented as `{ ownerPath, kind, offset }`, where `kind` comes from
`ResolvedPos.kind`; owner paths avoid comparing freshly minted IDs between
independent replay runs. The original retained-vs-canonical test continues to
compare DOM selection when both surfaces expose it, excluding only synthetic
composition selection.

## B. Deviations from the Phase 8b work order

| Spec/work-order expectation | Actual implementation | Reason | Reversal blast radius |
|---|---|---|---|
| Every generated complete session is replayed into both retained and canonical engines. | Five generated sessions are replayed twice through the canonical surface in each browser; the retained-vs-canonical comparator remains the original 11-intent trajectory. | The retained product path has no equivalent host-provider/file-picker route for every new parity command, and blindly comparing different affordances would create false evidence. | Medium/high for test infrastructure; no model contract change. This is the remaining gate-13 blocker. |
| Gate 14 can be declared after routing. | All nine parity families are routed and the observed retained trajectory has zero divergence, but full all-command dual-engine parity is not proven. | Gate 14 has a zero-difference bar; it must not be inferred from canonical-only replay. | Medium: build retained command adapters or an explicit retained-session command harness before promotion. |
| Media insertion remains product-compatible with the old prompt/media manager. | Canonical insertion requires a host `MediaProvider`; without one, media buttons are disabled. | The work order explicitly required the Phase 10 provider seed rather than a bespoke media manager. | Low for the public host contract; medium if a host wants legacy prompt fallback. |
| Four rollback bridges are removed in four commits. | All four remain, are marked `ROLLBACK_ADAPTER`, and are unreachable from canonical authority. | Deletion is an owner decision after promotion and was explicitly prohibited in this work order. | High operationally; deletion is still mandatory after a safe rollout. |
| No adapter-like format bridge remains. | DOCX/PDF routing uses existing legacy DOM conversion only at the format boundary (`legacyDocument()`); it is not used to discover or hold editing state. | DOCX/PDF codecs are a requested parity workflow, not authority migration. | Medium; format codec consolidation is Phase 9. |

No source-level operation or selection contract was renegotiated.

## C. Locked decisions in this delta

- **Gate enforcement:** the five repaired scripts test executable/source shape,
  not marker or documentation presence. Comments are stripped before positive
  checks. The Phase 8b gate is now in the root lint chain and CI.
- **Adapter accounting:** active canonical reachability is 0; retained
  rollback implementations are 4. All four carry `ROLLBACK_ADAPTER` markers.
  The marker name `MIGRATION_ADAPTER` is retired.
- **Media:** host supplies `MediaProvider`; no cloud SDK or credential path is
  allowed. Default picker is replaceable. Upload lifecycle is pending atom →
  async host upload → non-history attribute completion, with stale-node drop.
- **Attributed marks:** all four newly routed attributed controls use the
  existing generic declaration/command engine. No mark command body was added.
- **Block/list parity:** blockquote, movement, indentation/outdentation, and
  list preset controls call existing pure commands and caller-owned transaction
  routing.
- **Formats:** DOCX/PDF routes use the existing codec functions and binary-safe
  download helper; they do not become editing-state authorities.
- **Replay:** five generated sessions, 49 total migrated command intents, and 49
  semantic selection checkpoints per browser. Structure is normalized with IDs
  stripped; semantic points use owner path, resolved kind, and offset. The
  replay runs each session twice to detect nondeterminism.
- **Rollout:** flag default, legacy path, and four rollback bridges are
  unchanged. No promotion or deletion was performed.

## D. Gate results

| Gate | Result | Evidence |
|---|---|---|
| 12 — adapter inventory/authority reachability | **PASS under corrected tracker definition** | `scripts/check-phase8b-contract.mjs`; `docs/MIGRATION_ADAPTER_INVENTORY.md`; canonical product graph has 0 reachable rollback bridges, retained rollback inventory is 4, all marked. |
| 13 — session replay | **Qualified; literal stop condition remains open** | `packages/react/e2e/canonical-authority.spec.ts`: generated replay is 5 sessions/49 intents/49 semantic checkpoints in each of Chromium, Firefox, WebKit; retained-vs-canonical trajectory is 11 intents with 0 structural/selection divergence in all three browsers, excluding synthetic composition selection. The all-command retained counterpart is absent. |
| 14 — zero intentional behavior changes | **Qualified, not promotion-ready** | All nine requested parity families are routed. The observed 11-intent retained comparison reports 0 divergence. Because the generated all-command corpus is canonical-vs-canonical, this does not prove zero behavior change across every retained command. |
| 16 — prior suites and browser regression | **PASS** | Core Vitest 423/423; React Vitest 235/235; Playwright 235 passed, 5 intentional skips, 0 failures, 240 total across three browser projects. No removed test. |

### Gate-16 before/after counts

| Suite | Before this work order (prior delta report) | After | Removed tests |
|---|---:|---:|---|
| Core Vitest | 420 passed | 423 passed | None |
| React Vitest | 235 passed | 235 passed | None |
| Playwright, all projects | 213 total: 208 passed, 5 skipped | 240 total: 235 passed, 5 skipped | None |

The five Playwright skips are intentional: the opt-in Chromium CPU profile is
skipped unless `SRTE_PROFILE=1` (three project skips), and the headed
content-visibility experiment runs only in Chromium (two project skips). The
existing WebKit Phase 3 list-Enter timeout did **not** reappear in this full
run. No browser test was removed or renamed to hide a failure.

### Verification commands

```text
pnpm run lint                                  # passed
pnpm --filter smartrte-core test               # 51 files, 423 passed
pnpm --filter smartrte-react test              # 42 files, 235 passed
pnpm --filter smartrte-react e2e               # 240 total, 235 passed, 5 skipped
```

The targeted authority replay was also run directly across all three browsers:
22 passed and 2 intentional skips. The targeted toolbar/parity suite was 27/27
passed across all three browsers.

## E. Known gaps and uncertainty

1. The literal Gate-13 retained counterpart for all 49 generated command
   intents does not exist. The current evidence is strong canonical determinism
   plus the retained 11-intent trajectory, not a complete dual-engine proof.
2. The canonical media picker supports host upload injection and exposes the
   future `search`/`remove` interface, but no product media-library search UI
   was invented in this phase. That remains a Phase 10 extension point.
3. DOCX/PDF import/export is routed, but the format conversion boundary still
   uses legacy DOM codec functions. This is deliberately not counted as an
   editing-state adapter; Phase 9 owns codec consolidation.
4. Physical-device IME, NVDA, native Windows Word clipboard capture,
   server-side upload MIME validation, and a headed production trace remain
   previously assigned hardening items. They were not silently marked complete
   by this delta.
5. The generated replay compares semantic points by owner path rather than
   node ID because independent runs legitimately mint different IDs. This is
   correct for trajectory equivalence, but it is not an identity-restoration
   test; Phase 1 identity tests remain the authority for that invariant.

## F. Shadow and performance observations

### Retained-versus-canonical trajectory

| Browser | Sessions | Intents/session | Structural divergences | Selection caveat |
|---|---:|---:|---:|---|
| Chromium | 1 | 11 | 0 | Synthetic composition selection not compared; other comparable DOM selections were compared. |
| Firefox | 1 | 11 | 0 | Same. |
| WebKit | 1 | 11 | 0 | Same. |

The retained trajectory covers typing, selection, bold, undo/redo, focus/blur,
external replacement, paste, drop, and composition. It does not cover every
new list/table/block/atom/format route.

### Generated command sessions

Each browser ran these five session shapes twice from a fresh initial envelope:

| Session | Intents |
|---|---:|
| Marks, including attributed declarations and link | 12 |
| Blocks, including type, alignment, quote, movement, indent/outdent | 7 |
| Lists, including preset, check, nesting, movement and numbering | 12 |
| Tables, including merge/split, row/column mutation, headers and movement | 11 |
| Atoms, including image/video/audio/formula, resize/update/delete | 7 |
| **Total** | **49** |

All 49 semantic selection checkpoints compared equal in each browser. Media
URLs are normalized only for the playground provider's generated host URL;
model structure and resolved semantic positions are still compared.

The intents for which the retained surface cannot currently provide an honest
semantic counterpart are the provider-backed media picker/upload flow and
DOCX/PDF browser workflow. They are not silently counted as equivalent; they
are outside the retained all-command replay and are part of the Gate-13
qualification.

### Current production-surface input-to-paint samples

These are observations from the full Phase 8b suite (20 samples per size):

| Browser | 2,000 blocks (median / p95 / worst) | 10,000 blocks (median / p95 / worst) |
|---|---:|---:|
| Chromium | 16.7 / 17.6 / 18.9 ms | 24.2 / 28.1 / 28.7 ms |
| Firefox | 16 / 21 / 22 ms | 25 / 31 / 39 ms |
| WebKit | 15 / 30 / 37 ms | 36 / 51 / 52 ms |

The headed Chromium content-visibility experiment remains separate and was not
shipped. In the full run its baseline samples were approximately
`16.9, 33.0, 28.8, 23.6, 24.3 ms`; applying the candidate style produced
`723.6, 97.9, 68.8, 46.7, 49.8 ms`. This naive strategy is a regression, not a
promotion candidate.

## G. Migration-completion assessment

The canonical model is the single source of editing state **only when the
canonical authority flag is enabled**. It is not yet the repository-wide or
default-product authority without qualification:

- The flag remains off by default, so `LegacyClassicEditor` is still the live
  default path.
- Four rollback bridges remain in the legacy implementation: list, inline,
  block, and clipboard DOM round-trips. They are unreachable from the canonical
  graph and all are now explicitly marked `ROLLBACK_ADAPTER`.
- The canonical product path does not parse the live editable DOM to discover
  state, and it does not use `document.execCommand`.
- DOCX/PDF conversion reads a canonical snapshot to feed existing format codecs;
  this is a format boundary, not an editing-state bridge.

Therefore the migration is **not complete without qualification**. Before
promotion is safe, the owner still needs an explicit decision on the remaining
Gate-13/Gate-14 evidence: either provide a retained-session adapter for the
generated command corpus or approve a documented equivalence boundary for the
legacy-only affordances. After that decision and a green promotion review, the
four rollback bridges can be deleted in the owner-controlled rollout. This
report does not make either decision or deletion.

## H. Scope leakage

No unrequested feature family was added.

- No plugin runtime, plugin manifest, cloud upload backend, spreadsheet feature,
  clipboard parser outside Phase 8a, or new editing semantics were built.
- DOCX/PDF routing was implemented because it was one of the nine explicit
  parity gaps in item 4; it uses existing format functions.
- The MediaProvider default picker is a small host-injection reference, not a
  bespoke media manager.
- No canonical-authority flag promotion occurred.
- No rollback bridge was deleted.
- No `document.execCommand` call was introduced; the repository gate remains
  wired into lint and CI.

## What remains before promotion is safe

1. Close or explicitly owner-accept the literal all-command retained-vs-
   canonical replay qualification for Gate 13.
2. Re-run Gate 14 against that evidence and confirm no behavior change reaches
   a flag-on tenant.
3. Complete the owner review of the four-bridge deletion sequence; only then
   promote the flag and remove the rollback implementation.
4. Keep the previously assigned hardware/security hardening work visible; this
   delta does not waive it.
