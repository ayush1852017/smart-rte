# Phase 7 Atomic Content Engine completion report

**Overall status: HOLD on exit gate 13 only.** All four stop conditions (gates
3, 4, 9, and 10) pass. Automated a11y, atom semantics, and three-browser
composition pass, but atom-specific screen-reader announcement quality was not
manually validated. That manual result is not inferred from axe or from the
earlier general VoiceOver operability session.

## A. Implemented interfaces (verbatim)

Atom node specs:

```ts
const imageAttrs = {
  src: requiredString, alt: requiredString, width: dimension, height: dimension,
  status, uploadId: optionalString, error: optionalString, decorative: { validate: (value: unknown) => typeof value === "boolean" },
  align: { validate: (value: unknown) => value === "center" || value === "left" || value === "right" },
};
const formulaAttrs = {
  source: requiredString,
  notation: { required: true, default: "latex", validate: (value: unknown) => value === "latex" || value === "mathml" },
  error: optionalString,
};
const mediaAttrs = { src: requiredString, poster: optionalString, width: dimension, height: dimension, status, error: optionalString };

/** Inline and block variants are distinct because schema groups are static. */
export const atomNodeSpecs: readonly NodeSpec[] = [
  { type: "image", group: "inline", atomic: true, selectable: true, marks: "", attributes: imageAttrs },
  { type: "block_image", group: "block", atomic: true, selectable: true, marks: "", attributes: imageAttrs },
  { type: "formula", group: "inline", atomic: true, selectable: true, marks: "", attributes: formulaAttrs },
  { type: "block_formula", group: "block", atomic: true, selectable: true, marks: "", attributes: formulaAttrs },
  { type: "video", group: "block", atomic: true, selectable: true, marks: "", attributes: mediaAttrs },
  { type: "audio", group: "block", atomic: true, selectable: true, marks: "", attributes: mediaAttrs },
];
```

Atom declarations and command contract:

```ts
export type AtomKind = "image" | "formula" | "video" | "audio";
export type AtomStatus = "pending" | "ready" | "error";

export interface AtomDeclaration {
  readonly type: string;
  readonly kind: AtomKind;
  readonly group: "inline" | "block";
  readonly validate: (attrs: Attrs) => boolean;
}

export interface AtomCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type AtomCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: AtomCommandContext,
) => SmartOperation[];

export interface InsertAtomParams {
  readonly declaration: AtomDeclaration;
  readonly nodeId: string;
  readonly attrs: Attrs;
  /** Required for inline atoms. */
  readonly ownerId?: string;
  readonly offset?: number;
  /** Required for block atoms. */
  readonly parentId?: string;
  readonly index?: number;
}

export interface UpdateAtomParams { readonly attrs: Attrs }
export interface ResizeAtomParams { readonly width: number; readonly height: number; readonly minWidth?: number; readonly minHeight?: number; readonly preserveAspectRatio?: boolean }

export const atomCommands = { "atom.insert": insertAtom, "atom.update": updateAtom, "atom.delete": deleteAtom, "atom.resize": resizeAtom } as const;
```

Async insertion completion flow:

```ts
export interface AtomUploadCompletion { readonly src?: string; readonly error?: string }

/** Applies upload completion outside the insertion transaction and never resurrects deleted nodes. */
export const completeAtomUpload = (editor: FoundationEditor, nodeId: string, completion: AtomUploadCompletion): boolean => {
  const resolved = editor.positions.positionOf(nodeId);
  if (!resolved) return false;
  const index = resolved.kind === "inline" ? (() => {
    let offset = 0;
    for (let childIndex = 0; childIndex < (resolved.parent.children?.length || 0); childIndex += 1) {
      const child = resolved.parent.children![childIndex];
      if (!isTextNode(child) && child.id === nodeId && offset === resolved.pos.offset) return childIndex;
      offset += isTextNode(child) ? child.text.length : 1;
    }
    return -1;
  })() : resolved.pos.offset;
  const node = resolved.parent.children?.[index];
  if (!node || isTextNode(node) || node.id !== nodeId) return false;
  const before = node.attrs || {};
  const declaration = atomDeclarations.find((entry) => entry.type === node.type);
  const safeSource = completion.src && declaration && declaration.kind !== "formula"
    ? sanitizeAtomSource(completion.src, { kind: declaration.kind }) : null;
  const after: Attrs = safeSource
    ? { ...before, src: safeSource, status: "ready", uploadId: undefined, error: undefined }
    : { ...before, status: "error", uploadId: undefined, error: completion.error || "Upload failed" };
  editor.transact((transaction) => transaction.operations.push({
    type: "setNodeAttributes", pos: { path: [...resolved.pos.path, index], offset: 0 }, before, after: Object.fromEntries(Object.entries(after).filter(([, value]) => value !== undefined)),
  }), { source: "api", addToHistory: false });
  return true;
};

export const runAtomUpload = async (
  editor: FoundationEditor,
  nodeId: string,
  upload: () => Promise<{ src: string }>,
): Promise<boolean> => {
  try { return completeAtomUpload(editor, nodeId, await upload()); }
  catch (error) { return completeAtomUpload(editor, nodeId, { error: error instanceof Error ? error.message : "Upload failed" }); }
};
```

Composition tokenizer interface and implementation:

```ts
export interface CompositionAtomToken {
  readonly kind: "atom";
  readonly nodeId: string;
  readonly atomType: string;
}

export interface CompositionTextToken {
  readonly kind: "text";
  readonly text: string;
  readonly marks: readonly import("../types.js").SmartMark[];
}

export type CompositionToken = CompositionAtomToken | CompositionTextToken;

/** Mapping-aware tokens: atoms occupy one opaque unit and are never flattened. */
export const tokenizeCompositionOwner = (owner: SmartElementNode): CompositionToken[] => (owner.children || []).map((child) =>
  isTextNode(child)
    ? { kind: "text" as const, text: child.text, marks: [...(child.marks || [])] }
    : { kind: "atom" as const, nodeId: child.id, atomType: child.type });

export const compositionSegmentAt = (tokens: readonly CompositionToken[], offset: number): { from: number; to: number } => {
  let cursor = 0;
  for (const token of tokens) {
    const width = token.kind === "atom" ? 1 : token.text.length;
    if (token.kind === "atom" && (offset === cursor || offset === cursor + 1)) return { from: offset, to: offset };
    cursor += width;
  }
  cursor = 0;
  for (const token of tokens) {
    const width = token.kind === "atom" ? 1 : token.text.length;
    if (token.kind === "text" && offset >= cursor && offset <= cursor + width) return { from: cursor, to: cursor + width };
    cursor += width;
  }
  return { from: cursor, to: cursor };
};
```

## B. Deviations from spec

1. **Resize preview updates the DOM during the pointer gesture and commits one
   canonical `setNodeAttributes` change on pointer-up.** The foundation history
   supports same-`historyGroup` intermediate transactions, but the product
   surface avoids transaction/render churn during a drag. It still produces
   exactly one undo step. Reversal blast radius: low; renderer/controller detail.
2. **A composition attempting to cross an atom is rejected and the canonical
   owner is restored after composition, rather than synthesizing an early
   `compositionend`.** Adjacent composition reconciles normally. Reversal blast
   radius: medium in the input pipeline; model/position contracts are unchanged.
3. **Inline atom insertion currently returns one `replaceNode` for the inline
   owner**, because the frozen operation set has no direct insert-inline-node
   operation. The owner keeps its ID and descendant selection mapping now uses
   stable IDs through same-ID replacements. Reversal blast radius: low behind
   the pure command API, but operation payload/history size is larger than ideal.
4. **The standalone foundation formula fallback labels math with its source.**
   The product KaTeX path emits MathML with `trust: false`, but raw-source speech
   is not a sufficient accessible representation for complex LaTeX. Reversal
   blast radius: low contract impact, material a11y impact; add an accessible
   expression/speech attribute or a trusted math-to-speech adapter.
5. **Server-side MIME validation cannot be implemented in this repository.** It
   is documented as a required responsibility of the injected upload backend;
   client preflight validation is implemented. Reversal blast radius: none in
   editor contracts, external integration requirement.

## C. Locked decisions

- **Inline vs block typing:** distinct types (`image`/`block_image`,
  `formula`/`block_formula`); video/audio are block-only.
- **Upload state:** `status`, `uploadId`, and `error` attributes on the original
  atom. Completion preserves node identity.
- **Save during upload:** persistence fails loudly while an atom is pending.
  Any `blob:` URL is also rejected from persisted output.
- **Stale completion:** resolve by node ID first; missing nodes return `false` and
  are not resurrected.
- **Backspace:** inline atom deletes directly; block atom selects on the first
  press and deletes on the second.
- **Resize:** gesture-coalesced; one pointer drag is one history step. Keyboard
  resize is one discrete step per arrow press.
- **Composition boundary:** an atom is one opaque token; composition never spans
  it and crossing DOM drift is restored from canonical state.
- **SVG:** never rendered inline. Safe resource URLs use `<img src>` only.
- **Alternatives:** image command validation requires non-empty alt text or
  `decorative: true`; the decorative decision round-trips in HTML.
- **Special characters:** Unicode text, never atom nodes.

## D. Exit gate results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `foundation/atom/atom.test.ts`: throwaway `mention` declaration uses the unchanged generic insert command. |
| 2 | PASS | Phase 2 atom/grapheme matrix and full Phase 2 suite re-run; no inside-atom position. |
| 3 | PASS | `atom.test.ts` plus `canonical-surface.spec.ts` in all three browsers: completion is non-history, undo removes, stale completion returns false. |
| 4 | PASS | `atom.test.ts` persistence fixtures reject pending atoms and all blob URLs. |
| 5 | PASS | Unit atom selection/deletion and three-browser node-selection/backspace matrix. |
| 6 | PASS | Foundation gesture-group unit test plus product pointer-drag/undo in Chromium, Firefox, and WebKit. |
| 7 | PASS (synthetic-browser qualification) | Atom-adjacent composition passes Chromium/Firefox/WebKit with zero composing writes. No physical-device IME pass. |
| 8 | PASS | Generic nested list/table/marked-text fixture; no atom command branches on list/table/mark types. |
| 9 | PASS | Security fixture and Phase 7 contract grep: no inline SVG, evaluation, user `innerHTML`, or editable atom subtree. |
| 10 | PASS (editor boundary) | 18 shared Phase 4 URL fixtures plus Phase 7 hostile URL/MIME fixtures; atom policy imports `sanitizeResourceUrl`. Server validation remains injected-backend responsibility. |
| 11 | PASS | Error/pending round-trip and persistence fixtures preserve content; errors are not dropped. |
| 12 | PASS | Phase 7 lint/grep: product image/formula mutation routes through foundation commands; Classic retains rendering/UI orchestration only. |
| 13 | **FAIL — manual portion pending** | Automated axe and semantic tests pass in three browsers; atom-specific VoiceOver/NVDA announcement quality and keyboard-resize speech were not manually recorded. |
| 14 | PASS | Commit order: `6071c01` retained legacy atom engine; `d646c4c` later removed product fallbacks. |
| 15 | PASS | 2,100 retained scenarios, seed `0xA70B2027`, plus 700 per browser; zero semantic/data-loss/unknown. |
| 16 | PASS | Before → after: core `343→369`, React `221→223`, browser `156→174`. Full frozen suites pass. Removed tests: **none**. One Phase 3 test was renamed from “unsupported inline atoms” to “supported inline atoms” because images are now canonical; its round-trip assertion remains. |
| 17 | PASS | `PERFORMANCE_TRENDS.md`: isolated five-sample 2k/10k/50×50 series per browser. |
| 18 | PASS | Three adapters before and after; Phase 8 `3 → 2 → 1 → 0` authority/removal plan documented. |

Property disclosures:

- Atom apply/invert: 1,000 generated cases, seed `0xA70B2027`.
- Phase 1 operation/inversion and normalization properties: unchanged and green
  within `foundation.test.ts` (67/67).
- Phase 2 reverse selection: 2,500 cases, seed `0x5C0FE202`.
- Phase 2.5 structural sharing: 1,000 cases, seed `0xC025CAFE`.
- Phase 3 history: 1,000 cases, seed `0x13A57EED`; list shadow 3,000,
  seed `0x51A00300`.
- Phase 4 mark properties and 3,000 shadow cases, seed `0x1A4F2026`.
- Phase 5 retained block shadow: 3,000 cases, seed `0xB10C2026`.
- Phase 6 table geometry/undo: 1,000 cases, seed `0x6A1D2026`; table
  shadow 2,100, seed `0x7AB1E006`.

Final suite counts are core 369/369, React 223/223, and browser 174/174.
The first full browser attempt was 167/168 due to one pre-existing WebKit list
Enter timeout; it passed immediately in isolation, and the subsequent complete
run passed. This flake is disclosed rather than omitted.

## E. Known gaps and confidence limits

1. Gate 13's manual screen-reader pass is outstanding; use
   `PHASE7_MANUAL_VALIDATION.md`.
2. Physical Gboard/Samsung/Safari Indic/CJK candidate-window testing remains
   outstanding. Browser tests prove ownership and reconciliation only with
   programmatic composition events.
3. Complex LaTeX fallback speech is inadequate in the standalone renderer. The
   product KaTeX path has MathML, but manual speech quality is unverified.
4. Server-side upload MIME/content inspection is outside this package and must
   be enforced by the injected backend.
5. A 50×50 whole-table row operation retains 1,625,365 bytes in one history
   entry; 200 such entries imply about 325 MB before object overhead. This is a
   material Phase 6 debt, not caused by atoms.
6. Phase 6 transaction-validity relaxation remains logged as a Phase 12 blocker.
7. Mid-table Word header repair promotes preceding rows into the leading header
   region. It preserves content but can alter intended header semantics.

## F. Shadow results

Unit retained corpus, seed `0xA70B2027`, 2,100 cases:

- 600 equivalent
- 900 `equivalent-serialization`
- 600 `expected-normalization`
- 0 `selection-only`, `visual-only`, `semantic`, `data-loss`, or `unknown`

Each browser ran 700 cases with the same outcome:

| Browser | Equivalent | Equivalent serialization | Expected normalization | Semantic/data-loss/unknown |
|---|---:|---:|---:|---:|
| Chromium | 200 | 300 | 200 | 0 |
| Firefox | 200 | 300 | 200 | 0 |
| WebKit | 200 | 300 | 200 | 0 |

Corrections of legacy behaviour:

1. Unsafe `javascript:`/HTML-data resource URLs are rejected (100 cases per
   browser; 300 unit cases).
2. Unsafe data MIME types, including SVG data, are rejected (100/browser; 300
   unit cases).
3. KaTeX trust is explicitly disabled instead of relying on defaults.
4. Missing image alternatives require user intent; decorative state persists.
5. Block atom Backspace is select-then-delete rather than immediate loss.
6. Atom-crossing flat-text composition is rejected/restored.
7. Upload errors remain content and stale completion cannot resurrect a node.

Logs contain hashes, classifications, and correction codes only—no document
text.

## G. Security review

| User-controlled DOM sink | Control |
|---|---|
| Image `src` | Shared `sanitizeResourceUrl`; safe scheme/data-MIME allowlist; assigned as an `<img>` attribute. |
| Image `alt` | Assigned with `setAttribute`; command requires text or explicit decorative state. |
| Image dimensions/alignment | Numeric bounds and enumerated alignment at schema/command boundary. |
| Formula source in standalone renderer | `textContent`, escaped data attribute, `role="math"`; no user HTML. |
| Formula source in product KaTeX | KaTeX DOM renderer with `trust: false`, `strict: "error"`; no eval path. |
| Audio/video `src` and video `poster` | Shared resource sanitizer; native element attributes only. |
| Upload-handler result | Revalidated at async completion before `setNodeAttributes`. |
| Atom HTML export | Attribute escaping plus URL sanitizer. |
| Pending preview | Blob allowed only in live pending rendering; persistence rejects it. |
| Resize handles/status UI | Editor-created `data-smart-ui`, `contentEditable=false`, excluded from model/serialization. |

Hostile fixtures cover mixed-case `javascript:`, `vbscript:`, HTML data URLs,
SVG data URLs with event handlers, `file:`, NUL/control characters, malformed
URLs, hostile update/completion results, oversized dimensions, formula tags and
handlers, parse errors, pending state, and blob persistence. The complete list
and expected control is in `PHASE7_SECURITY_FIXTURES.md`.

No Phase 7 code requires CSP `unsafe-inline` or `unsafe-eval`.

## H. Scope leakage

- Clipboard parsing: **not implemented**. HTML/Markdown/DOCX/PDF atom format
  adapters operate on canonical content; they are not clipboard parsers.
- Upload backend/CDN: **not implemented**. Existing injected handler is consumed.
- Plugin runtime: **not implemented or changed**.
- Phase 8 adapter removal: **not implemented**; only the required one-page plan
  was added.
- Formula editor beyond insert-source: **not implemented**.
- Adapter count: **3 → 3**.

