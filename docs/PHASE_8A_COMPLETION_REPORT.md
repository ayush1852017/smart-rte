# Phase 8a Clipboard and Normalization Pipeline completion report

**Verdict: PROCEED TO PHASE 8b WITH AN EXPLICIT OWNER WAIVER.** Stop-condition gates 2, 12, and 13 pass. Native Word for Windows was not captured, so gates 3 and 5 remain unevidenced rather than being relabelled as passes. On 2026-08-05 the owner explicitly accepted that source as residual risk. A native Windows capture remains a Phase 11/pre-production hardening item.

## A. Implemented interfaces (verbatim)

```ts
export const NATIVE_CLIPBOARD_MIME = "application/x-smart-rte+json";

export type ClipboardSource =
  | "native"
  | "word"
  | "google-docs"
  | "spreadsheet"
  | "markdown"
  | "html"
  | "plain-text";

export interface RawClipboardPayload {
  readonly html?: string;
  readonly plainText?: string;
  readonly native?: string;
  readonly types?: readonly string[];
  /** Complete MIME map when available; used by size guards and adapters. */
  readonly representations?: Readonly<Record<string, string>>;
}

export interface ClipboardDetection {
  /** A normalizer-selection hint. Correctness must not depend on this value. */
  readonly source: ClipboardSource;
  readonly signals: readonly string[];
}

declare const sanitizedClipboardBrand: unique symbol;

/** Only the sanitizer stage can construct this input for a source normalizer. */
export interface SanitizedClipboardPayload {
  readonly [sanitizedClipboardBrand]: true;
  readonly source: ClipboardSource;
  readonly html: string;
  readonly plainText: string;
  readonly document: Document;
}

export interface NormalizedClipboardPayload {
  readonly html: string;
  readonly plainText: string;
  readonly repairs: readonly string[];
}

export interface SourceNormalizer {
  readonly id: string;
  readonly sources: readonly ClipboardSource[];
  normalize(payload: SanitizedClipboardPayload): NormalizedClipboardPayload;
}

export interface ClipboardFragment {
  readonly source: ClipboardSource;
  readonly document: SmartDocument;
  readonly repairs: readonly (Repair | string)[];
}

export interface ClipboardRepresentations {
  readonly [NATIVE_CLIPBOARD_MIME]: string;
  readonly "text/html": string;
  readonly "text/plain": string;
}

export interface ClipboardPipelineOptions {
  readonly ownerDocument: Document;
  readonly normalizers?: readonly SourceNormalizer[];
  /** Test/audit switch proving detection is never required for correctness. */
  readonly normalizerMode?: "detected" | "generic";
  readonly maxBytes?: number;
}

export interface ClipboardStructuralShape {
  readonly nodeCounts: Readonly<Record<string, number>>;
  readonly maxDepth: number;
  readonly textCodeUnits: number;
}

export interface ClipboardDiagnosticReport {
  readonly version: 1;
  readonly fixtureHash: string;
  readonly detectedSource: ClipboardSource;
  readonly detectionSignals: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly inputBytes: number;
  readonly status: "parsed" | "rejected";
  readonly structuralShape: ClipboardStructuralShape | null;
  readonly repairs: readonly string[];
  readonly failureCode?: "payload-too-large" | "parse-failed";
}
```

```ts
/** Detection selects an optimization/normalizer only; generic parsing remains the fallback. */
export const detectClipboardSource = (payload: RawClipboardPayload): ClipboardDetection => {
  const html = payload.html || "";
  const types = new Set(payload.types || []);
  if (payload.native || types.has(NATIVE_CLIPBOARD_MIME)) return { source: "native", signals: [NATIVE_CLIPBOARD_MIME] };
  if (/<table\b/i.test(html) && /(?:google-sheets-html-origin|data-sheets-root|mso-number-format|Microsoft Excel)/i.test(html)) {
    return { source: "spreadsheet", signals: ["table-with-spreadsheet-marker"] };
  }
  const wordSignals = [
    /\bmso-[\w-]+\s*:/i.test(html) && "mso-style",
    /<!--\[if\s+gte\s+mso/i.test(html) && "mso-conditional-comment",
    /xmlns:(?:o|w)\s*=/i.test(html) && "office-namespace",
    /\b(?:data-listid|data-ccp-props|class=["'][^"']*\bSCXW)/i.test(html) && "office-web-marker",
  ].filter((value): value is string => Boolean(value));
  if (wordSignals.length) return { source: "word", signals: wordSignals };
  if (/\bid=["']docs-internal-guid-/i.test(html)) return { source: "google-docs", signals: ["docs-internal-guid"] };
  if (types.has("vscode-editor-data") && markdownPattern.test(payload.plainText || "")) return { source: "markdown", signals: ["vscode-plain-text-structure"] };
  if (html) return { source: "html", signals: ["text/html"] };
  if (markdownPattern.test(payload.plainText || "")) return { source: "markdown", signals: ["plain-text-structure"] };
  return { source: "plain-text", signals: ["text/plain"] };
};
```

```ts
export const DEFAULT_MAX_CLIPBOARD_BYTES = 5 * 1024 * 1024;

export const estimateClipboardPayloadBytes = (payload: RawClipboardPayload): number => {
  const values = payload.representations
    ? Object.values(payload.representations)
    : [payload.html || "", payload.plainText || "", payload.native || ""];
  return values.reduce((total, value) => total + new TextEncoder().encode(value).byteLength, 0);
};

/**
 * The only public raw-payload entry point. Its call graph fixes the security
 * order as detect -> sanitize -> normalize -> parse -> schema repair.
 */
export const parseClipboardPayload = (
  payload: RawClipboardPayload,
  options: ClipboardPipelineOptions,
): ClipboardFragment => {
  const bytes = estimateClipboardPayloadBytes(payload);
  const maximum = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_CLIPBOARD_BYTES));
  if (bytes > maximum) throw new ClipboardPayloadTooLargeError(bytes, maximum);
  const detection = detectClipboardSource(payload);
  const plainText = payload.plainText || "";
  const rawHtml = payload.html || textAsHtml(options.ownerDocument, plainText);
  const sanitized = sanitizeClipboardHtml(options.ownerDocument, detection.source, rawHtml, plainText);
  const normalizer = options.normalizerMode === "generic" ? genericNormalizer
    : options.normalizers?.find((candidate) => candidate.sources.includes(detection.source))
      || capturedSourceNormalizers.find((candidate) => candidate.sources.includes(detection.source))
      || genericNormalizer;
  const normalized = normalizer.normalize(sanitized);
  const parsed = detection.source === "native" && payload.native
    ? parseNativeClipboardDocument(payload.native)
    : parseCanonicalListHtml(normalized.html);
  const repaired = repair({ ...parsed, id: parsed.id || createNodeId() }, foundationSchema);
  return { source: detection.source, document: repaired.doc, repairs: [...normalized.repairs, ...repaired.repairs] };
};
```

```ts
export declare const insertClipboardFragment: (document: SmartDocument, selection: SmartSelection, fragment: SmartDocument, context: ClipboardInsertionContext) => ClipboardInsertionResult;
export declare const serializeClipboardRepresentations: (document: SmartDocument) => ClipboardRepresentations;
export declare const sliceClipboardSelection: (document: SmartDocument, selection: SmartSelection) => SmartDocument;
export declare const deleteClipboardSelection: (document: SmartDocument, selection: SmartSelection, positions: PositionLookup) => ClipboardDeletionResult;
```

## B. Deviations from spec

| Spec | Implementation | Reason | Reversal blast radius |
|---|---|---|---|
| P0 includes Word Windows | A Windows DOCX-derived reference exists, but no native Windows Word clipboard capture exists | Mammoth conversion is useful parser input but does not reproduce Windows clipboard HTML | High for source-specific evidence; low for API shape. Windows Office-version quirks remain unproven. |
| Word list normalization handles literal-glyph `mso-list` paragraphs | Implemented against the genuine macOS Word capture, with a synthesized nested/ordered regression test | The replacement Mac payload contains real `mso-list`, conditional comments, `<o:p>`, VML, and marker spans | Medium, localized to the Word source normalizer. Windows-specific variants remain unproven. |
| Native application fixture exercises lossless custom MIME | Current product capture contains legacy HTML only and is detected as Word | Native MIME is emitted by the canonical surface, but the current product remains DOM-authoritative until 8b | Low for the pipeline; medium for product integration evidence. |
| Browser drag test uses the browser's complete drag gesture | The three-browser test calls the pipeline's drag-start entry point with a real `DataTransfer`, then drops through the public drop entry point | Synthetic native selection changes made dispatched drag events engine-dependent; the model move contract is what this test isolates | Low code blast radius; evidence gap for pointer-driven drag UX. |
| Phase 1 transaction source union omitted cut | Added the additive `"cut"` member and routed cut deletion through it | This is the last cheap point to preserve authorship/telemetry intent; exhaustive switches will identify consumers requiring treatment | Low now; delaying it would permanently conflate cut with paste replacement. |
| Adapter inventory reported three while `canonicalClipboardRuntime.ts` still used `execCommand("insertHTML")` | The runtime is now marked and inventoried as a fourth migration adapter | It is functionally a parse→serialize→DOM-insert authority bridge even though it lives outside `adapters/` | Low to disclose; Phase 8b's real retirement target changes from `3→0` to `4→0`. |
| No production-oriented corpus-growth mechanism was required | Added hash-only parsed/rejected diagnostics containing source, structural shape, repair codes, and no document content | Real-source coverage will grow from observed failures, so privacy-safe evidence collection must exist before 8b | Additive callback/API; low reversal blast radius. |
| Large payload may show progress or refuse | A hard 5 MiB refusal with a diagnostic was chosen | Small, deterministic, secure behavior for 8a | Low; a progress pipeline can be added behind the same entry point. |
| Server-side upload MIME validation carried forward | Not implemented here | This repository contains no FastAPI/upload backend | External-system gap; no clipboard API blast radius. |
| Markdown source reused the pre-foundation compatibility converter | It uses the canonical foundation Markdown parser/serializer | The original import escaped the frozen foundation boundary and failed lint | Low; canonical output hash changed once and is now frozen by the captured fixture test. |

## C. Locked decisions

- Detection is a hint only. Native MIME wins, spreadsheet markers are checked before Word markers, then Word, Google Docs, Markdown, generic HTML, and plain text. Every captured fixture also runs through the generic path.
- DOMPurify 3.x is the HTML sanitizer. Sanitization is structurally before normalization through the branded `SanitizedClipboardPayload`; the Phase 8a lint gate checks call ordering.
- Word `mso-list` paragraphs are grouped by list ID/override and level; literal marker spans are removed, orderedness is inferred from the marker, and nesting is materialized. Docs/Office-web runs carrying `aria-level`/`data-aria-level` continue to use declared-level regrouping.
- A grid pasted into a cell becomes a nested table. Phase 6 makes nested tables legal and geometry repair runs afterward.
- A multi-block fragment pasted into a list becomes sibling list items after the target item. Existing list fragments contribute their items.
- The nearest schema node with `defining: true` is reported and preserved; blockquote and table-cell identity remain stable while their content changes.
- Clean HTML strips `data-smart-id` and all `data-smart-ui` nodes. Copy also writes the lossless native MIME and plain text.
- The size guard is 5 MiB over the complete representation map. Oversized input throws `ClipboardPayloadTooLargeError` before parsing.
- Clipboard diagnostics contain a deterministic fixture hash, detected source/signals, MIME names, byte count, node-type counts/depth/text length, repair codes, and a coarse failure code. They never contain HTML, plain text, node IDs/attributes, repair messages, or exception messages.

## D. Exit-gate results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `pipeline.test.ts` order probe; `check-phase8a-contract.mjs` enforces sanitize-before-normalize. |
| 2 | PASS | `pipeline.test.ts`: 1,000 lossless native documents, seed `0x8a2026`. |
| 3 | **OWNER-WAIVED, NOT PASS** | `corpus.test.ts` passes for eight real captures, including genuine desktop Word macOS HTML, but the required native Word Windows P0 clipboard capture is absent. The supplied Windows DOCX conversion remains reference-only. Owner accepted this residual risk on 2026-08-05. |
| 4 | PASS for captured corpus | `corpus.test.ts`: all eight real captures survive generic parsing and validate without losing sampled visible text. This does not substitute for the missing P0 fixture. |
| 5 | **OWNER-WAIVED, NOT PASS** | Real macOS `mso-list` bullet paragraphs pass, and a synthesized fixture proves nested ordered conversion. The captured Mac sample has only level-1 bullets, and no native Windows capture proves nested ordered/unordered Office variants. Owner accepted this residual risk on 2026-08-05. |
| 6 | PASS | `corpus.test.ts`: Excel/Sheets tables and captured merged spans survive and use Phase 6 repair. |
| 7 | PASS | `insertion.test.ts`: defining owner, list, nested table, code, cross-block, and atom cases. `clipboard-workflows.spec.ts` covers browser insertion. |
| 8 | PASS | `input.test.ts` and three-browser workflow: paste-over-selection is one history entry and one undo. |
| 9 | PASS | `insertion.test.ts`: code-block paste becomes unmarked plain text. |
| 10 | PASS | `input.test.ts` and browser workflow: native, clean HTML, plain text; no smart IDs/UI nodes. |
| 11 | PASS | `clipboard-workflows.spec.ts`: external drop and internal move pass Chromium, Firefox, WebKit. |
| 12 | PASS | Hostile fixtures in `pipeline.test.ts`; DOMPurify; shared `sanitizeResourceUrl`; automated lint rejects a third policy. |
| 13 | PASS | `pipeline.test.ts`: 1,000 generated unknown custom elements, seed `0x8a0bad`. |
| 14 | PASS | `normalizers.property.test.ts`: deterministic/idempotent/local 1,000 cases, seed `0x8A11CE`; pass cap remains Phase 1-owned. |
| 15 | PASS | `check-phase8a-contract.mjs`: no clipboard event handling/cleaner remains in `ClassicEditor.tsx`. |
| 16 | PASS | Retention commit `856425e` precedes deletion commit `77b45ec`. |
| 17 | PASS with corpus limitation | Eight captures × three browsers = 24 shadow scenarios. Each browser: 8 `expected-normalization`, 0 semantic, 0 data-loss, 0 unknown. The missing Windows fixture is not represented. |
| 18 | PASS | Phase 7 baseline → current Phase 8a: core `369→416`, React `223→229`, browser `174→186`. Removed tests: none. One old browser assertion was updated to require the new precise no-payload diagnostics. |
| 19 | PASS | `corpus.test.ts`: 10× the complete largest captured representation map = 27,136,620 bytes (the Mac fixture includes RTF); observed 512.37 ms in the final unit run with an explicit benchmark allowance. The normal 5 MiB guard rejects it, and the configured threshold boundary also passes. |
| 20 | **DEVIATION, CORRECTED INVENTORY** | The three feature adapters did not increase, but the already-existing Phase 8a clipboard DOM-insertion bridge makes the honest authority-boundary count 4. Source markers, inventory, and lint now agree on four; Phase 8b owns `4→3→2→1→0`. |

Full final runs: `pnpm check` passed (`416/416` core, `229/229` React); Playwright `186/186` passed across Chromium, Firefox, and WebKit.

## E. Known gaps and confidence limits

1. Native Word Windows remains an accepted evidence gap, not a proven path. The corpus contains real `mso-list`, conditional-comment, `<o:p>`, namespace, and VML payloads from Word macOS, but the supplied Windows file is explicitly a Mammoth DOCX conversion. Reopen this at Phase 11/pre-production when Windows access is available.
2. The current product's “native” capture is not native MIME. Exact native round-trip is property-tested and canonical-surface-tested, but not captured from the current ClassicEditor product path.
3. The product remains DOM-authoritative after the canonical parser returns clean HTML. `canonicalClipboardRuntime.ts` intentionally uses `execCommand("insertHTML")`; 8b owns replacing this with persistent canonical authority.
4. The clipboard shadow corpus has eight composite real captures, not thousands of distinct captures. It is cross-browser but shallow in source/version diversity.
5. Capture notes/platform fields were not consistently populated, so exact application versions are not proven by fixture metadata.
6. Real pointer-driven internal drag UX is not automated. The operation is verified through browser `DataTransfer` and pipeline entry points.
7. Server-side upload MIME validation remains external to this repository.
8. Headed physical-browser `content-visibility`, physical-device IME, and NVDA validation remain carried items before Phase 9.
9. Existing React list tests still emit `act(...)` warnings. They pass, but the warning noise can hide new warnings.

## F. Shadow results

| Browser | Captures | Equivalent | Expected normalization | Semantic | Data loss | Unknown |
|---|---:|---:|---:|---:|---:|---:|
| Chromium | 8 | 0 | 8 | 0 | 0 | 0 |
| Firefox | 8 | 0 | 8 | 0 | 0 | 0 |
| WebKit | 8 | 0 | 8 | 0 | 0 | 0 |

The full intentional-change catalogue is `docs/PHASE8A_BEHAVIOR_CHANGE_CATALOGUE.md`. Corrections: wrapper removal, declared-level list regrouping, spreadsheet metadata/style removal with geometry repair, canonical GFM parsing, and preservation of plain-text-only payloads. Logs contain fixture IDs, classification, hashes, and conservation booleans only.

## G. Corpus honesty

| Fixture | Provenance | What it proves / does not prove |
|---|---|---|
| `word-macos` | **Captured from real application** | Proves a real desktop Mac Word path with `mso-list` marker spans, conditional comments, `<o:p>`, VML fallback, table, and image. This particular capture has level-1 bullet lists only; it does not prove Windows output or nested/ordered Word lists. |
| `google-docs` | **Captured from real application** | Proves the captured Docs wrapper, list, table, marks, link, and image payload. |
| `google-sheets` | **Captured from real application** | Proves the captured Sheets grid/merged-cell path. |
| `excel` | **Captured from real application** | Proves the captured Excel grid/merged-cell path; formulas/number semantics are intentionally text-only. |
| `markdown-plain-text` | **Captured from real application (VS Code clipboard)** | Proves source detection and canonical GFM parsing for this captured text. |
| `native-smart-rte` | **Captured from the current product** | Proves current legacy HTML capture; it does not contain native MIME and is honestly detected as Word. |
| `plain-text` | **Captured** | Proves paragraph/tab preservation for the captured plain payload. |
| `generic-web` | **Captured from a real page** | Browser supplied plain text only; it does not prove hostile or rich generic-web HTML. |
| Hostile HTML fixtures | **Synthesized** | Security regression inputs only; not representative of Word/Docs. |
| Generated native documents | **Synthesized/property generated** | Native algebra only, seed `0x8a2026`. |
| Generated unknown elements | **Synthesized/property generated** | Unknown preservation only, seed `0x8a0bad`. |
| 10× payload | **Synthesized by repetition of the largest real capture** | Size/latency guard only; not a representative 27.1 MiB clipboard document. |
| `word-windows-docx-reference` | **Converted/synthesized from a file via Mammoth** | Parser-development convenience only. It is stamped `docx-reference`, stored outside `fixtures/captured`, tested for valid non-destructive parsing, and cannot satisfy a captured-source gate. |

Real-world sources still uncovered: native Word Windows clipboard output (blocking), Word Online, Outlook, Notion, Confluence, Apple Notes, and rich generic web HTML. Windows may expose marker, namespace, VML, and list-level variants absent from the Mac capture; the P2 sources may expose new wrapper, list, and style patterns but are not Phase 8a P0.

## H. Scope leakage

- Canonical-authority takeover: **not implemented**. Four authority bridges remain: three feature round-trip adapters and the now-explicit clipboard DOM-insertion bridge.
- Adapter removal: **not implemented**. The inventory correction changed the reported baseline from 3 to 4 without introducing a new bridge; Phase 8b owns `4→3→2→1→0`.
- Plugin runtime: **not implemented in this phase**.
- Product whole-file import: **not implemented**. The developer-only capture page can convert DOCX into an explicitly non-captured reference fixture; that result never enters the P0 corpus or product clipboard pipeline.
- Clipboard parsing, canonical-fragment insertion routing, and product paste routing are in scope. The external product runtime is temporary 8a scaffolding and is explicitly owned for deletion/replacement by 8b.
