# Phase 9 — Format Codecs, Package Boundary, and Public API Completion Report

Snapshot: 2026-08-13, branch `core-implementation`, commits `cb05f88`..`7787383`.

`docs/bugs/` was checked before this phase's work began and again before writing this report, per the standing `CLAUDE.md` rule. No open or "not a bug" entry matched anything encountered this phase. Six new entries were added during the phase (§H, §E); none was a regression of a previously-fixed bug.

Per standing instruction, this report surfaces deviations and gaps rather than summarizing favorably. Where a gate or claim did not hold on first check, that is stated directly, not reframed.

## A. Implemented interfaces (verbatim)

`packages/core/src/foundation/formats/codec.ts`:

```ts
export type FormatId = "html" | "markdown" | "docx" | "pdf";
export type FormatFidelityLevel = "full" | "semantic" | "lossy" | "unsupported";

export interface ParseContext {
  readonly format: FormatId;
}
export interface SerializeContext {
  readonly format: FormatId;
}

export interface FeatureFormatCodec<TFeature extends string = string> {
  readonly feature: TFeature;
  readonly format: FormatId;
  readonly fidelity: FormatFidelityLevel;
  readonly note: string;
  parse?: (input: unknown, ctx: ParseContext) => SmartNode | SmartNode[] | null;
  serialize?: (node: SmartNode, ctx: SerializeContext) => unknown;
  fallback?: (node: SmartNode) => SmartNode | null;
}

export interface DocumentFormatCodec {
  readonly format: FormatId;
  parseDocument?: (input: unknown, ctx: ParseContext) => SmartDocument;
  serializeDocument?: (document: SmartDocument, ctx: SerializeContext) => unknown;
}
```

`packages/core/src/foundation/formats/fidelity.ts`:

```ts
export type FidelityFeature =
  | "inline-marks" | "colors-fonts-sizes" | "headings-alignment" | "blockquote-code"
  | "lists" | "checklists" | "tables" | "links" | "images-media" | "formulas" | "special-characters";

export interface FormatFidelityCapability { level: FidelityLevel; note: string }
export interface FeatureFidelityContract { feature: FidelityFeature; formats: Record<FidelityFormat, FormatFidelityCapability> }
export const builtInFormatFidelity: readonly FeatureFidelityContract[]; // 11 features
export const getFormatFidelity: (feature: FidelityFeature, format: FidelityFormat) => FormatFidelityCapability;
```

`packages/core/src/foundation/formats/featureCodecs.ts` (new this phase, §3 gate 3):

```ts
export const builtInFeatureFormatCodecs: readonly FeatureFormatCodec<FidelityFeature>[]; // 44 entries
```

`packages/core/src/foundation/surface/renderer.ts` (live KaTeX, §2.4):

```ts
const KATEX_OPTIONS = { trust: false, strict: "error" as const };
```

`packages/react/src/canonicalEditorRuntime.ts` (pre-existing, formalized as the headless facade in §2.5, unchanged this phase except its own imports):

```ts
export interface SmartEditorHandle {
  getValue(): PersistedEditorDocument;
  replaceValue(doc: PersistedEditorDocument, opts?: { keepSelection?: boolean }): void;
  isDirty(): boolean;
  markSaved(revision: number): void;
  getRevision(): number;
  focus(): void;
  executeOperations(operations: readonly SmartOperation[], opts?: ExecuteOperationsOptions): void;
  createCheckpoint(): SmartEditorCheckpoint;
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void;
}
export class CanonicalEditorRuntime implements SmartEditorHandle { /* mount/unmount + above */ }
export const createCanonicalEditorRuntime: (options?: CanonicalEditorRuntimeOptions) => CanonicalEditorRuntime;
```

## B. Deviations from spec

1. **Gate 3 ("every feature × format pair has a declared `FeatureFormatCodec`") is satisfied with an explicitly documented scope limit, not full implementation.** Only 8 of 44 cells (`images-media` and `formulas`, all 4 formats) got a real `parse`/`serialize` function, because only those have an underlying single-node implementation (`atom/formats.ts`). The other 36 cells' real logic — `docx/export.ts`, `pdf/format.ts`, the list/table/block/marks HTML/Markdown/DOCX/PDF serializers — is whole-document, not per-node, and does not decompose into this interface without a genuine refactor. That refactor was explicitly scoped out this session (confirmed by the repo owner rather than assumed) and is tracked as follow-up in `docs/PHASE_9_EXIT_GATES.md`. The 36 cells carry fidelity metadata (`feature`/`format`/`fidelity`/`note`) but `parse`/`serialize` are `undefined`.
2. **The "13-gate exit verification" found real gaps on first check, not just confirmations.** Gates 4, 6, and 13 did not pass cleanly the first time they were checked against actual evidence rather than assumed from prior work — see §D. This is reported directly rather than folded quietly into a single "all gates pass" summary.
3. **`SmartEditorFacade` was not introduced as a new class.** Earlier framing of this phase (before this report was written) described "a `SmartEditorFacade` wrapping `CanonicalEditorRuntime`/`SmartEditorHandle`." On inspection, `CanonicalEditorRuntime`/`SmartEditorHandle` already had zero React imports and a complete public surface — adding another wrapper class around it would have added a layer with no new capability, which this project's stated conventions treat as a defect (premature abstraction), not a virtue. The existing class was formalized and tested as the facade instead.
4. **The Chrome browser extension needed for live visual inspection remained unavailable throughout this phase.** Gate 6's "browser" verification requirement was still met — a real Playwright assertion against actual rendered KaTeX DOM in chromium/firefox/webkit — but no human/AI visual screenshot inspection of rendered math ever happened this phase. Recorded as a residual item in `docs/PHASE_9_RELEASE_POLICY.md`, not silently treated as fully closed.

## C. Locked decisions

- **Version:** both packages move to `1.0.0-beta.1` (from `smartrte-core@0.2.1`, `smartrte-react@0.3.4`), on the basis that every previously-published version predates the canonical model entirely (§1.1 finding). Not published to npm — package.json/CHANGELOG changes only.
- **Publish channel:** `--tag beta`, never `--tag latest`, until the criteria in `docs/PHASE_9_RELEASE_POLICY.md` close (29 deferred e2e tests, NVDA+Chrome validation, native Windows Word capture — all carried forward from before this phase, not newly discovered).
- **`canonicalAuthorityFlag`:** removed entirely (not deprecated), after confirming zero real npm consumer could depend on the previous rollback behavior (§1.1: neither package has ever shipped the canonical model).
- **Public API boundary:** `smartrte-core`'s root (`.`) and `/foundation` both export the canonical model only. `/legacy` is the sole home for the pre-canonical discriminated-union model, its plugin system, and the HTML/Markdown compatibility layers — previously also flatly duplicated at root, which is what this phase fixed.
- **`CanonicalEditorRuntime` stays in `smartrte-react`**, not relocated to `smartrte-core`, despite having zero React dependency — it is documented and tested as framework-agnostic, but a package relocation was judged to add packaging risk for no behavioral change.

## D. Exit gate results

Full table with evidence: `docs/PHASE_9_EXIT_GATES.md`. Summary: **13/13 pass, including all 3 stop conditions (2, 4, 6)**, but three of those did not pass on first inspection:

| Gate | First-check result | What was actually wrong | Resolution |
|---|---|---|---|
| 4 (stop condition) | Unverified at required rigor | No systematic check had ever been run against all 44 fidelity-table cells; `special-characters` (11th feature) had zero fixture coverage across all 4 formats, and `images-media`/PDF only tested the `video` atom type, never `image` | Full 44-cell audit performed; 6 new tests added closing both gaps |
| 6 (stop condition) | Partial | Unit tests (5/5) passed, but no Playwright test ever asserted on real rendered KaTeX DOM in a live browser — the "+ browser" half of the gate's own verification method had never happened | Added a real `.katex`/`<math>` assertion to the production toolbar-insertion e2e test; confirmed passing live in chromium, firefox, webkit |
| 13 | Partial | 4 of 6 phase-relevant bugs were ledgered; 2 (`atomToDocx`'s formula-as-image inconsistency, the imprecise DOCX inline-marks fidelity note) were fixed in §2.2/§2.3 but never given a `docs/bugs/` entry — a direct miss against the standing `CLAUDE.md` rule | Backfilled both entries this session |

Gate 3 (not a stop condition) also required a scope negotiation rather than a clean pass or fail — see §B.1.

## E. Known gaps and uncertainty

Carried forward from before this phase, unchanged by it (none of these were in Phase 9's scope, and none regressed):

- **29 e2e tests** deferred at Phase 8b closeout (table Tab/Shift+Arrow navigation and undo-coalescing prioritized) remain unwritten. `docs/PHASE_8B_FINAL_CLOSEOUT.md` §1.
- **NVDA + Chrome manual accessibility validation** remains outstanding, flagged across Phases 4, 5, 6, and 7, never closed by any phase since.
- **Native Windows Word clipboard capture** remains an owner-waived residual risk from Phase 8a, explicitly named there as a "Phase 11/pre-production hardening item."

New this phase:

- **36 of 44 `FeatureFormatCodec` cells have no real `parse`/`serialize`** (§B.1) — closing this requires refactoring whole-document walkers into per-node, context-carrying functions, a substantial project not attempted here.
- **KaTeX rendering has never been visually inspected** in a live browser session by a human or the assistant — only asserted programmatically (DOM structure, unit behavior). The Chrome extension was unavailable throughout.
- **No dedicated CVE/security audit was run against the four new runtime dependencies** added this phase (`katex`, `jszip`, `mammoth`, `pdfjs-dist`, `@xmldom/xmldom`) beyond the trust/strict/sanitization behavior covered in §G. Standard `npm audit`-class scanning was not part of this phase's work.

## F. Round-trip fixture results

The 44-cell fidelity audit (gate 4, §D) is the phase-specific analog of prior phases' "shadow results." Full breakdown: `docs/PHASE_9_EXIT_GATES.md`, gate 4 row. In addition, pre-existing corpus/property tests unrelated to this phase's changes were re-run as part of every full-suite pass this phase and stayed clean throughout, with no adjustment needed: the atom shadow corpus (2,100 scenarios), table shadow corpus (2,100 scenarios), clipboard normalizer property test (1,000 fragments), and structural history property test (1,000 cases) — none of these were touched by Phase 9's format-codec or public-API work, and none regressed.

## G. Security review

- **KaTeX:** `trust: false` (blocks `\includegraphics`/`\href`/etc. from executing side effects), `strict: "error"` (rejects non-standard LaTeX rather than silently accepting it), `throwOnError` defaults `true` and is caught with a plain-text fallback in `renderFormulaInto` — an invalid or malicious formula source can never leave the formula atom's own DOM subtree in a broken or executable state. Directly tested: `formulaRendering.test.ts`'s "rejects untrusted commands per `trust:false`" (no `<img>` injected from `\includegraphics`) and "falls back to the raw source... for invalid LaTeX" (no throw escapes to the caller).
- **DOCX import (`mammoth`, `@xmldom/xmldom`):** no real DOM is used anywhere in the codec (`parse5` for HTML-shaped parsing, `@xmldom/xmldom` for the styled-import XML path) — this was a deliberate §2.1 design choice for framework/environment agnosticism, and incidentally removes an entire class of DOM-based XSS surface from the import path. `sanitizeAtomSource` (pre-existing, Phase 7) continues to gate image/media `src` values reached through any import path, DOCX included.
- **New dependencies this phase:** `katex`, `jszip`, `mammoth`, `pdfjs-dist`, `@xmldom/xmldom` (the last pinned to `^0.9.11`, the latest non-deprecated release, after the default resolution initially landed on a deprecated `0.8.11`). No dedicated vulnerability scan was run against any of these — see §E.

## H. Scope leakage

Work done beyond the minimum needed to satisfy the letter of each section, found and fixed while verifying rather than deferred:

- `packages/core/src/foundation/list/index.ts` was missing `export * from "./presets.js"` — `FOUNDATION_SMART_LIST_PRESETS` existed but was never reachable from `smartrte-core/foundation` at all, a pre-existing gap unrelated to this phase's own changes, surfaced only because pruning root's accidental fallback path (§2.5) exposed it. Fixed.
- 20 internal test files inside `packages/core/src` imported their own package's legacy exports via the relative root barrel (`./index.js`/`../index.js`) instead of `./legacy/index.js`/`../legacy/index.js` — broken by the same §2.5 prune, not previously noticed because `tsc -p tsconfig.json` excludes `*.test.ts`. Fixed; `pnpm build` had stayed green throughout, masking this until `vitest run`.
- Two production/test-harness files (`legacyListShadowComparator.ts`, `CanonicalAuthorityEditor.tsx`) depended on foundation-native symbols leaking through the root barrel's now-removed legacy re-export. Fixed at the import site rather than restoring the leak.
- The `<li>` double-processing HTML parser bug (§2.1) and the Markdown silent-deletion-of-images/formulas bug (§2.3) were both found via direct testing against real captured clipboard fixtures and full round-trip verification, not flagged by any prior report — both pre-dated Phase 9 and were unrelated to the specific task being executed when found.

## I. Fidelity table

Complete 44-cell matrix. Level and note come from `builtInFormatFidelity` (`fidelity.ts`), the single source of truth; `featureCodecs.ts` mirrors this exactly. "Fixture" cites the test that verifies the claim (all 44 confirmed present as of gate 4's audit this phase; 6 were added this phase to close real gaps, marked with *).

| Feature | HTML | Markdown | DOCX | PDF |
|---|---|---|---|---|
| inline-marks | **full** — `marks/formats.test.ts` | **semantic** — `marks/formats.test.ts` | **semantic** — `docx/format.test.ts` (per-mark) | **lossy** — `marks/formats.test.ts` |
| colors-fonts-sizes | **full** — `marks/formats.test.ts` | **unsupported** — `marks/formats.test.ts` | **semantic** — `docx/format.test.ts` | **lossy** — `marks/formats.test.ts` |
| headings-alignment | **full** — `block/formats.test.ts` | **lossy** — `block/formats.test.ts` | **semantic** — `docx/format.test.ts` + `block/formats.test.ts` | **lossy** — `block/formats.test.ts` |
| blockquote-code | **full** — `block/formats.test.ts` | **semantic** — `block/formats.test.ts` | **lossy** — `docx/format.test.ts` | **lossy** — `block/formats.test.ts` |
| lists | **full** — `list/formats.test.ts` | **semantic** — `list/formats.test.ts` | **semantic** — `docx/format.test.ts` + `list/formats.test.ts` | **lossy** — `pdf/format.test.ts` |
| checklists | **full** — `list/formats.test.ts` | **semantic** — `list/formats.test.ts` | **lossy** — `docx/format.test.ts` | **lossy** — `list/formats.test.ts` |
| tables | **full** — `table/formats.test.ts` | **lossy** — `table/formats.test.ts` | **semantic** — `docx/format.test.ts` + `table/formats.test.ts` | **lossy** — `pdf/format.test.ts` |
| links | **full** — `marks/formats.test.ts` | **semantic** — `marks/formats.test.ts` | **semantic** — `docx/format.test.ts` | **lossy** — `marks/formats.test.ts` |
| images-media | **semantic** — `atom/formats.test.ts` | **lossy** — `list/formats.test.ts` | **semantic** — `docx/format.test.ts` | **lossy** — `atom/formats.test.ts`* (image type added this phase) |
| formulas | **full** — `atom/formats.test.ts` | **semantic** — `list/formats.test.ts` | **lossy** — `docx/format.test.ts` | **lossy** — `featureCodecs.test.ts`* |
| special-characters | **full** — `list/formats.test.ts`* | **full** — `list/formats.test.ts`* | **full** — `docx/format.test.ts`* | **semantic** — `pdf/format.test.ts`* |

## J. KaTeX scope confirmation

Built from scratch. §1.2 investigation (before implementation began) found no dormant KaTeX renderer anywhere in the codebase — what existed was decorative, unused infrastructure: a CDN `<script>`/`<link>` tag pair in `packages/react/playground/index.html` (a `window.katex` global that nothing in the actual renderer code ever referenced), and a version-mismatched `katex` devDependency in the playground's own `package.json` (`^0.16.22` vs. what would become core's `^0.18.4`). The formula atom's schema (`source`, `notation` attrs) and DOM-sync mechanism (`syncNodeAttributes`, called from both `createNode` and `diffElement`) already existed from Phase 7 and were reused as-is — only the actual rendering call (`katex.render(source, element, KATEX_OPTIONS)`) and its accessible-name/fallback wiring were new. The dead CDN tags and the mismatched playground dependency were removed/fixed as part of this work (§H-adjacent cleanup, folded into the §2.4 commit).

## K. Public API diff

### `smartrte-core` root (`.`)

**Before** (40 lines — `foundation/index.js` plus the entire legacy-model surface flattened into the same namespace):
```
export * from "./foundation/index.js";
export * from "./model.js";
export * from "./command.js";
export * from "./editor.js";
export * from "./marks.js";
export * from "./plugin.js";
export * from "./preset.js";
export * from "./history.js";
export * from "./selection.js";
export * from "./listScope.js";
export * from "./listPresets.js";
export * from "./selectionMapping.js";
export * from "./schema.js";
export * from "./table.js";
export * from "./transaction.js";
export * from "./tree.js";
export * from "./legacyCommands/{list,code,marks,alignment,checklist,media,formula,inlineAtoms,blocks,table,move}.js";
export * from "./plugins/{basicFormatting,list,checklist,media,formula,alignment,codeBlock,blockType,blockquote,table,move}.js";
export * from "./html/compatibility.js";
export * from "./markdown/compatibility.js";
export * from "./security/urlPolicy.js";
```

**After** (1 export, everything above except the first line moved exclusively behind `smartrte-core/legacy`, which already existed and already contained the identical list):
```
export * from "./foundation/index.js";
```

### `smartrte-core/foundation`

**Before → After:** unchanged except one addition: `export * from "./formats/index.js";` was added in §2.1 (bringing in the new codec/fidelity/DOCX/PDF surface), and within `list/index.ts`, `export * from "./presets.js";` was added in §2.5 (a pre-existing gap, unrelated to this phase's own work, fixed because it was found while auditing the boundary).

### `smartrte-react`

**Removed:** `canonicalAuthorityFlag` + `CanonicalAuthorityContext`/`CanonicalAuthorityFlagSnapshot` types (§1.1); `createDocumentFormatRegistry`/`defaultDocumentFormatRegistry`/`DocumentFormatRegistry`/`exportTextDocument`/`getDocumentFormatAdapter`/`importTextDocument`/`roundTripTextDocument` + `DocumentFormatAdapter`/`DocumentImportContext`/`TextDocumentFormat` types (§2.1, `documentFormats.ts` retired); `createEditorFormatRuntime` + `BuiltInDocumentFormat`/`EditorDocumentFormat`/`EditorFormatConfig`/`EditorFormatDefinition`/`EditorFormatExportContext`/`EditorFormatExportResult`/`EditorFormatImportContext`/`EditorFormatImportResult`/`EditorFormatRuntime` types (§2.1, `formatRuntime.ts` retired); `createBuiltInFormatDefinitions` + `BuiltInFormatDefinitionOptions` type (§2.1, `builtInFormatDefinitions.ts` retired).

**Changed source, same export names:** `DOCX_MEDIA_TYPE`/`exportDocxDocument`/`importDocxDocumentWithMammoth`/`smartDocumentToDocxXml`/`enhanceDocxTables`/`importStyledDocxDocument`/`buildPdfPrintDocument`/`importPdfDocument`/`PDF_MEDIA_TYPE`/`reconstructPdfPages` (were from local `./adapters/{docxFormat,styledDocxFormat,pdfFormat}.js`, now re-exported from `smartrte-core/foundation`); `builtInFormatFidelity`/`getFormatFidelity` (same, from `./formatFidelity.js` → `smartrte-core/foundation`).

**Added:** `printSmartDocumentAsPdf` now from `./adapters/pdfPrint.js` (the browser-only print-window piece, split out of the old `pdfFormat.ts`); `FeatureFormatCodec`/`DocumentFormatCodec`/`FormatId`/`FormatFidelityLevel`/`ParseContext`/`SerializeContext` types (§2.2, new).

**Unchanged:** `ClassicEditor`/`ClassicEditorProps`, `CanonicalAuthorityEditor`/`CanonicalAuthorityEditorProps`, `CanonicalEditorRuntime`/`createCanonicalEditorRuntime`/`SmartEditorChange`/`SmartEditorCheckpoint`/`SmartEditorHandle`, all media/theme/plugin-runtime exports, `DomTableCommand`.

## Test count accounting (before → after, with every removed test named)

**Core:** 461/461 → 495/495 (+34). All growth; nothing removed from core this phase.

**React:** 122/122 → 97/97 (-25 net). Full accounting, reconciled exactly:
- Removed via file deletion (9 files, 29 tests): `adapters/documentFormats.test.ts` (7), `adapters/docxFormat.test.ts` (5), `adapters/pdfFormat.test.ts` (3), `adapters/pdfImport.test.ts` (3), `adapters/portableDocxAtoms.test.ts` (2), `adapters/styledDocxFormat.test.ts` (1), `builtInFormatDefinitions.test.ts` (3), `formatFidelity.test.ts` (2), `formatRuntime.test.ts` (3) — every one of these covered functionality relocated to `packages/core`'s own, often-expanded test suite (§A's core count includes the replacements), not a net loss of verification.
- Removed from within a kept file (1 test): `canonicalEditorRuntime.test.tsx`'s flag-resolution test, deleted alongside `canonicalAuthorityFlag.ts` itself (4 → 3 tests in that file).
- Added (2 files, 5 tests): `adapters/pdfPrint.test.ts` (2, new browser-only print-window piece), `canonicalEditorRuntime.headless.smoke.test.ts` (3, new — the gate 9 facade proof).
- `122 - 29 - 1 + 5 = 97`. Exact.

**E2e (all 7 files, no filter, 3 browsers — the corrected definition per Phase 8b closeout §1, not the two-file assumption that caused that gap):** **250 passed, 5 expected skips, 0 failures, identical before and after this phase.** No e2e test was added, removed, or renamed this phase; one existing test (`canonical-toolbar-routing.spec.ts`'s production formula-insertion test) gained two new assertions (gate 6's `.katex`/`<math>` check) without changing the total test count. Re-run three times during this phase (after §2.5, after §2.6, after §3) with identical results each time; one isolated single-browser flake was observed and confirmed non-reproducing on retry (`does not duplicate rapid typing after repeated block moves`, webkit-only, passed 1/1 in isolation) — consistent with the flake pattern already documented from Phase 8b, not a new or unresolved issue.
