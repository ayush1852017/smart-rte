# Phase 8b Canonical Authority Takeover completion report

**Verdict: HOLD.** The retained canonical runtime and opt-in production surface
are implemented, but stop gates 12–14 are not satisfied. Canonical authority is
not promoted globally. No user is exposed to the incomplete toolbar parity by
default.

## A. Implemented interfaces (verbatim)

From `packages/react/src/canonicalEditorRuntime.ts`:

```ts
export interface SmartEditorCheckpoint {
  envelope: PersistedEditorDocument;
  selection: SmartSelection;
  storedMarks?: SmartMark[];
  savedRevision: number;
}

export interface SmartEditorChange {
  revision: number;
  documentChanged: boolean;
  transaction: SmartTransaction;
}

export interface SmartEditorHandle {
  getValue(): PersistedEditorDocument;
  replaceValue(doc: PersistedEditorDocument, opts?: { keepSelection?: boolean }): void;
  isDirty(): boolean;
  markSaved(revision: number): void;
  getRevision(): number;
  focus(): void;
  createCheckpoint(): SmartEditorCheckpoint;
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void;
}

export interface CanonicalEditorRuntimeOptions {
  initialValue?: string | PersistedEditorDocument;
  onChange?: (change: SmartEditorChange) => void;
  onHtmlChange?: (html: string) => void;
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
}
```

From `packages/react/src/components/ClassicEditorAuthority.tsx`:

```ts
export type ClassicEditorProps = Omit<LegacyClassicEditorProps, "value" | "onChange"> & {
  /** Initial-only under canonical authority. Use replaceValue for external changes. */
  defaultValue?: string | PersistedEditorDocument;
  /** Legacy HTML value. Ignored after canonical construction. */
  value?: string;
  onChange?: ((change: SmartEditorChange) => void) | ((html: string) => void);
  onHtmlChange?: (html: string) => void;
  canonicalAuthority?: boolean;
  authorityContext?: CanonicalAuthorityContext;
  onRuntime?: CanonicalAuthorityEditorProps["onRuntime"];
};
```

Lifecycle entry points from `CanonicalEditorRuntime`:

```ts
constructor(options: CanonicalEditorRuntimeOptions = {}) {
  const envelope = envelopeFrom(options.initialValue);
  this.editor = createFoundationEditor({
    document: envelope.document,
    revision: envelope.revision,
    selection: firstTextSelection(envelope.document),
  });
  this.savedRevision = envelope.revision;
  this.onChange = options.onChange;
  this.onHtmlChange = options.onHtmlChange;
  this.onClipboardDiagnostic = options.onClipboardDiagnostic;
}

mount(root: HTMLElement): void {
  if (this.root === root && this.pipeline && this.renderer) return;
  this.unmount();
  this.root = root;
  this.renderer = createSubtreeRenderer(root);
  this.pipeline = createInputPipeline(this.editor, this.renderer, root, { onClipboardDiagnostic: this.onClipboardDiagnostic });
  this.unsubscribe = this.editor.subscribe((transaction, state) => {
    this.renderer?.render(this.editor.document, this.editor.selection);
    this.onChange?.({ revision: state.revision, documentChanged: sameOperations(transaction), transaction });
    if (sameOperations(transaction)) this.onHtmlChange?.(serializeCanonicalListHtml(state.document, { clean: true }));
  });
}

unmount(): void {
  this.unsubscribe?.();
  this.unsubscribe = null;
  this.pipeline?.destroy();
  this.pipeline = null;
  this.renderer?.destroy();
  this.renderer = null;
  this.root?.replaceChildren();
  this.root = null;
}
```

Renderer mount interface from `packages/core/src/foundation/surface/types.ts`:

```ts
export interface CanonicalSubtreeRenderer {
  readonly mapping: ModelDomMapping;
  readonly composingNodeId: string | null;
  readonly domWriteCount: number;
  readonly composingDomWriteCount: number;
  render(document: SmartDocument, selection: SmartSelection): void;
  beginComposition(nodeId: string): void;
  endComposition(): void;
  resetWriteCounters(): void;
  destroy(): void;
}
```

## B. Deviations from spec

| Spec | Actual | Reason | Reversal blast radius |
|---|---|---|---|
| Canonical authority becomes the product default | Runtime flag defaults off; `?canonicalAuthority=1` and the direct prop enable it | Gates 12–14 are not complete; default-on would ship missing toolbar behaviour | Low: one flag default after the gates pass |
| Adapter inventory reaches repository-wide zero | Canonical product graph is zero; four adapters remain in `LegacyClassicEditor` for runtime rollback | Deleting rollback before promotion contradicts gate 1 | Medium: delete legacy export and four modules after promotion |
| Four reviewed adapter-removal commits | Adapters were made unreachable from canonical authority in one commit; rollback implementations remain | There was no honest four-step deletion to commit | Low mechanically, high release risk until replay is complete |
| Full session replay covering every feature and lifecycle intent | One three-intent typing trajectory runs in three browsers and reports the first divergence | The comparator mechanism was proven, not the required corpus | Medium test work; no contract change |
| Zero behaviour changes | Canonical toolbar currently exposes generic marks, block type, alignment, undo and redo; it lacks legacy list/table/media/formula affordances | The retained runtime landed before full toolbar routing | Medium UI routing work; command/model contracts are already present |
| Clean canonical `onChange` signature | Transitional union also accepts legacy `(html: string) => void`, with `onHtmlChange` provided explicitly | Maintains source compatibility during flag rollout | Medium public API cleanup after legacy deletion |
| Preserve arbitrary external selection by ID | `keepSelection` preserves a collapsed active owner and clamps its offset; ranges/direction reset | Smallest safe policy implemented | Medium; extend ID mapping to both endpoints |
| Repository-wide literal grep contains no `execCommand` | Executable TS and rebuilt Flutter asset contain none; historical Markdown and the grep script mention the term | Historical reports are evidence, not executable code | Low; do not rewrite history merely to satisfy a literal text grep |
| Checkpoint gate is manual | Automated unit and three-browser restore coverage exists; no manual crash/reload exercise was performed | Automation was available; a human reload session was not | Low |

## C. Locked decisions

- Controlled vs uncontrolled: canonical mode is uncontrolled. `defaultValue` is
  consumed once; replacement is imperative.
- External replacement selection: reset to the first editable position by
  default; `keepSelection` preserves the collapsed owner by stable ID and clamps
  its offset when possible.
- StrictMode construction: runtime is allocated through a retained `useRef`;
  effects only mount/unmount renderer and listeners. Unmount clears projected DOM.
- Decorations: renderer-owned projections marked `data-smart-ui`; inventory is
  in `PHASE8B_DECORATION_INVENTORY.md`.
- Flag: direct prop, document, tenant, global precedence. Development default is
  off. Promotion requires replay, composition, browser, parity and performance
  review.
- Checkpoints: exact envelope, selection, stored marks and saved revision; restore
  begins a new history epoch without recreating the editor.
- Rollback: canonical content is serialized to clean HTML on the legacy boundary.
  Legacy edits become the next canonical initial value. Content survives; stable
  IDs are reminted across a rollback edit.

## D. Exit gate results

| # | Result | Evidence |
|---|---|---|
| 1 | Pass with ID qualification | `canonicalEditorRuntime.test.tsx`: global/tenant/document/direct flag precedence and canonical → legacy → canonical edit preservation |
| 2 | Pass with transitional callback deviation | `PHASE8B_CANONICAL_AUTHORITY.md`, exported props |
| 3 | Pass | StrictMode test. It found and fixed duplicate initial DOM during effect replay |
| 4 | Pass | Prop-change test retains runtime identity and state |
| 5 | Pass for implemented product surface | `canonical-authority.spec.ts`, all three browsers |
| 6 | Pass, synthetic browser composition | Instrumented product renderer, Chromium/Firefox/WebKit; zero composing writes |
| 7 | Pass for canonical surface | `PHASE8B_DECORATION_INVENTORY.md` + product contract scan |
| 8 | Pass for canonical command graph | `scripts/check-phase8b-contract.mjs` |
| 9 | Pass for executable source and shipped Flutter asset; literal repository grep qualified | Source/artifact grep returned zero |
| 10 | Pass | Host API unit tests and authority contract doc |
| 11 | Pass | Transaction listener tests; revision dirty/checkpoint tests |
| 12 | **Fail — stop condition** | Active canonical count is zero, but four rollback adapters remain; no four deletion commits |
| 13 | **Fail — stop condition** | 1 session × 3 typing intents × 3 browsers, zero divergence; required full intent matrix absent |
| 14 | **Fail — stop condition** | Missing canonical toolbar affordances are user-visible differences if the flag is forced on |
| 15 | Pass | Core 416→418; React 229→234; browser 186→201 total (199 expected, 2 project skips). Removed tests: none |
| 16 | Pass measurement; performance concern | 20 samples per browser at both sizes, below |
| 17 | Pass | Headed Chromium trace captured. Experiment-only content visibility was slower and was not shipped |
| 18 | Pass | React 234-test output contains no `act()` warning |
| 19 | Automated pass, manual not done | Unit + browser checkpoint restoration |

Property seeds inherited and rerun: Phase 1/2.5 `0xC025CAFE` (1,000), Phase 3
history `0x13A57EED` (1,000), list shadow `0x51A00300` (3,000), Phase 4
`0x1A4F2026` (3,000), Phase 5 `0xB10C2026` (3,000), Phase 6 `0x7AB1E006`
(2,100), Phase 7 `0xA70B2027` (2,100), Phase 8a `0x8a0bad`, `0x8a2026`,
and `0x8A11CE` (1,000 each). Phase 8b replay is deterministic browser coverage,
not a generated property test.

Commits created by work item:

- `1ca4580` retained editor state replacement
- `bf9cdf5` canonical runtime and host API
- `033c975` active authority primitive retirement
- `40b6f41` browser verification and diagnostics
- `bbc38b0` rollback round-trip preservation
- `36dbb97` rebuilt canonical Flutter embed

## E. Known gaps and uncertainty

1. Full product toolbar parity is incomplete: list, table, atom/media, formula,
   link editing, import/export, resize and contextual affordances are not routed
   by `CanonicalAuthorityEditor` yet.
2. Session replay is far too thin to justify promotion. It does not include
   composition, migrated commands, interleaved history, external replacement,
   clipboard, drag/drop, or focus/blur trajectories.
3. The legacy rollback implementation remains DOM-authoritative and publicly
   exported. Its four bridges are dormant only while the canonical flag is on.
4. A rollback edit remints stable IDs at the HTML boundary. Content is preserved,
   but annotations keyed by node ID would not be safe across rollback.
5. `keepSelection` does not preserve ranged or reverse selections.
6. Physical-device IME, NVDA, Windows Word native clipboard and server MIME work
   remain the previously assigned Phase 11 debts.
7. The production 10,000-block renderer is materially slower than the standalone
   baseline. Promotion should not ignore this.

## F. Session-replay shadow and performance

Shadow actually run:

| Browser | Sessions | Intents/session | Divergence |
|---|---:|---:|---:|
| Chromium | 1 | 3 consecutive text intents | 0 |
| Firefox | 1 | 3 consecutive text intents | 0 |
| WebKit | 1 | 3 consecutive text intents | 0 |

The comparator records the first divergent intent. During development it exposed
an invalid comparison caused by different native click caret positions; the
test now explicitly establishes the same semantic caret before replay. No
behaviour change reached default users because the rollout flag remains off.

Isolated 20-sample production input-to-paint results:

| Browser | Blocks | Median | p95 | Worst |
|---|---:|---:|---:|---:|
| Chromium | 2,000 | 16.7 ms | 19.1 ms | 20.1 ms |
| Chromium | 10,000 | 48.2 ms | 51.7 ms | 57.1 ms |
| Firefox | 2,000 | 16 ms | 18 ms | 18 ms |
| Firefox | 10,000 | 40 ms | 46 ms | 50 ms |
| WebKit | 2,000 | 17 ms | 30 ms | 30 ms |
| WebKit | 10,000 | 55 ms | 62 ms | 65 ms |

The headed Chromium 10k trace measured baseline samples of 41.2–46.3 ms. The
experiment that set `content-visibility:auto` on every block measured
55.2–699.2 ms because mass style application/layout outweighed any skipping.
That implementation was not shipped. The trace disproves that naive strategy;
it does not disprove a renderer-integrated Phase 11 design.

## G. Migration completion assessment

No: the repository is not canonical-single-authority without qualification.

- With canonical authority enabled, the retained `FoundationEditor` is the
  single source of truth. Input, selection, clipboard, renderer, host API and the
  implemented toolbar commands do not parse live editable DOM for state.
- With the rollback flag disabled, `LegacyClassicEditor` remains DOM-authoritative
  and uses four inventoried bridges. Owner: rollout completion after the missing
  Phase 8b parity/replay gates, not a later feature phase.
- The shipped Flutter asset was rebuilt from the canonical standalone host and no
  longer contains the stale legacy bundle.

Therefore the migration architecture works on the opt-in path, but the takeover
is not complete and Phase 9 should not start.

## H. Scope leakage

No new editing feature, format codec, or plugin runtime was implemented. A
privacy-safe clipboard diagnostic callback was threaded into the canonical input
pipeline because it was explicit Phase 8b carry-forward work. The generated
Flutter asset was rebuilt because otherwise a shipped product surface would have
remained DOM-authoritative.

