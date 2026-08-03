# Smart RTE Phase 4 — Inline Formatting Engine Completion Report

**Verdict:** PROCEED BY EXPLICIT PRODUCT-OWNER ACCEPTANCE (2026-08-03), with
residual risks. The available macOS/Safari manual smoke pass succeeded, but
Phase 4 does not retroactively satisfy every literal gate: NVDA + Chrome and
physical-device Indic/CJK IME remain untested, and Gate 12's required
commit-order evidence is permanently unavailable for this worktree. These are
recorded exceptions, not relabelled passes.

## A. Implemented interfaces (verbatim)

### Mark command set and tool declaration shape

```ts
export interface MarkCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type MarkCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: MarkCommandContext,
) => SmartOperation[];

export interface MarkApplyParams { readonly markType: string; readonly attrs?: Attrs }
export interface MarkRemoveParams { readonly markType: string }
export interface MarkToggleParams extends MarkApplyParams {
  /** Supplied from Phase 2 describe(); commands do not recompute coverage. */
  readonly coverage: "all" | "partial" | "none";
}
export interface MarkSetAttrsParams extends MarkApplyParams {}
export interface MarkClearAllParams {}
export interface LinkEditParams { readonly href: string; readonly target?: string }

export interface InlineToolDeclaration {
  readonly id: string;
  readonly markType: string;
  readonly inclusive: boolean;
  readonly excludes?: readonly string[];
  readonly validate?: (attrs: Attrs | undefined) => boolean;
}

export interface MarkApplicationReport {
  readonly ownerCount: number;
  readonly atomOwnersSkipped: readonly string[];
  readonly partial: boolean;
}

export const applyMarkCommand: MarkCommand<MarkApplyParams> = (document, scope, params, ctx) => {
  const mark = markFor(params, ctx);
  const excluded = new Set([mark.type, ...(ctx.schema.marks[mark.type]?.excludes || [])]);
  return ranges(scope, ctx).flatMap((range) => [
    ...removalsFor(document, range, excluded),
    { type: "addMark" as const, range, mark },
  ]);
};

export const removeMarkCommand: MarkCommand<MarkRemoveParams> = (document, scope, params, ctx) =>
  ranges(scope, ctx).flatMap((range) => removalsFor(document, range, new Set([params.markType])));

export const toggleMarkCommand: MarkCommand<MarkToggleParams> = (document, scope, params, ctx) =>
  params.coverage === "all"
    ? removeMarkCommand(document, scope, params, ctx)
    : applyMarkCommand(document, scope, params, ctx);

export const setMarkAttrsCommand: MarkCommand<MarkSetAttrsParams> = applyMarkCommand;

export const clearAllMarksCommand: MarkCommand<MarkClearAllParams> = (document, scope, _params, ctx) =>
  ranges(scope, ctx).flatMap((range) => textMarksInRange(document, range).map((mark) => ({ type: "removeMark", range, mark })));

export const removeLinkCommand: MarkCommand<MarkRemoveParams> = (document, scope, params, ctx) => {
  const run = collapsedLinkRun(document, scope);
  return run
    ? [{ type: "removeMark", range: run.range, mark: run.mark }]
    : removeMarkCommand(document, scope, { markType: params.markType || "link" }, ctx);
};

export const editLinkCommand: MarkCommand<LinkEditParams> = (document, scope, params, ctx) => {
  const run = collapsedLinkRun(document, scope);
  const attrs = { href: params.href, ...(params.target ? { target: params.target } : {}) };
  if (!run) return applyMarkCommand(document, scope, { markType: "link", attrs }, ctx);
  const replacement = markFor({ markType: "link", attrs }, ctx);
  return [
    { type: "removeMark", range: run.range, mark: run.mark },
    { type: "addMark", range: run.range, mark: replacement },
  ];
};

export const markCommands = {
  "mark.apply": applyMarkCommand,
  "mark.remove": removeMarkCommand,
  "mark.toggle": toggleMarkCommand,
  "mark.setAttrs": setMarkAttrsCommand,
  "mark.clearAll": clearAllMarksCommand,
  "link.remove": removeLinkCommand,
  "link.edit": editLinkCommand,
} as const;
```

### `MarkSpec` exclusion/inclusivity declarations

```ts
export const inlineMarkSpecs = [
  { type: "bold", inclusive: true },
  { type: "italic", inclusive: true },
  { type: "underline", inclusive: true },
  { type: "strike", inclusive: true },
  { type: "code", inclusive: true },
  { type: "superscript", inclusive: true, excludes: ["subscript"] },
  { type: "subscript", inclusive: true, excludes: ["superscript"] },
  { type: "textColor", inclusive: true, excludes: ["textColor"], attributes: { value: stringValue } },
  { type: "backgroundColor", inclusive: true, excludes: ["backgroundColor"], attributes: { value: stringValue } },
  { type: "fontSize", inclusive: true, excludes: ["fontSize"], attributes: { valuePx: numberValue } },
  { type: "fontFamily", inclusive: true, excludes: ["fontFamily"], attributes: { value: stringValue } },
  { type: "link", inclusive: false, excludes: ["link"], attributes: {
    href: stringValue,
    target: { validate: (value: unknown) => typeof value === "string" && Boolean(value) },
  } },
] as const satisfies readonly MarkSpec[];

export const inlineToolDeclarations = [
  { id: "bold", markType: "bold", inclusive: true },
  { id: "italic", markType: "italic", inclusive: true },
  { id: "underline", markType: "underline", inclusive: true },
  { id: "strikethrough", markType: "strike", inclusive: true },
  { id: "inlineCode", markType: "code", inclusive: true },
  { id: "superscript", markType: "superscript", inclusive: true, excludes: ["subscript"] },
  { id: "subscript", markType: "subscript", inclusive: true, excludes: ["superscript"] },
  { id: "textColor", markType: "textColor", inclusive: true, excludes: ["textColor"], validate: (attrs) => canonicalColor(attrs?.value) !== null },
  { id: "backgroundColor", markType: "backgroundColor", inclusive: true, excludes: ["backgroundColor"], validate: (attrs) => canonicalColor(attrs?.value) !== null },
  { id: "fontSize", markType: "fontSize", inclusive: true, excludes: ["fontSize"], validate: (attrs) => canonicalFontSize(attrs?.valuePx) !== null },
  { id: "fontFamily", markType: "fontFamily", inclusive: true, excludes: ["fontFamily"], validate: (attrs) => canonicalFontFamily(attrs?.value) !== null },
  { id: "link", markType: "link", inclusive: false, excludes: ["link"], validate: (attrs) => normalizeLinkInput(String(attrs?.href || "")).href !== null },
] as const satisfies readonly InlineToolDeclaration[];
```

### `resolveMarkRun`

```ts
export interface ResolvedMarkRun {
  readonly mark: SmartMark;
  readonly range: SmartRange;
  readonly ownerNodeId: string;
}

/** Resolves the complete contiguous run for one exact mark at a collapsed position. */
export const resolveMarkRun = (
  document: SmartDocument,
  pos: SmartPos,
  markType: string,
): ResolvedMarkRun | null => {
  const owner = nodeAtPath(document, pos.path);
  if (!owner || isTextNode(owner)) return null;
  let offset = 0;
  const segments = (owner.children || []).map((node) => {
    const from = offset;
    offset += isTextNode(node) ? node.text.length : 1;
    return { node, from, to: offset };
  });
  const active = [...segments].reverse().find((segment) => isTextNode(segment.node)
    && segment.from < pos.offset && pos.offset <= segment.to
    && segment.node.marks?.some((mark) => mark.type === markType))
    ?? segments.find((segment) => isTextNode(segment.node)
      && segment.from <= pos.offset && pos.offset < segment.to
      && segment.node.marks?.some((mark) => mark.type === markType));
  if (!active || !isTextNode(active.node)) return null;
  const mark = active.node.marks?.find((candidate) => candidate.type === markType);
  if (!mark) return null;
  const key = markKey(mark);
  let from = active.from;
  let to = active.to;
  const index = segments.indexOf(active);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const segment = segments[cursor];
    if (!isTextNode(segment.node) || !segment.node.marks?.some((candidate) => markKey(candidate) === key)) break;
    from = segment.from;
  }
  for (let cursor = index + 1; cursor < segments.length; cursor += 1) {
    const segment = segments[cursor];
    if (!isTextNode(segment.node) || !segment.node.marks?.some((candidate) => markKey(candidate) === key)) break;
    to = segment.to;
  }
  return {
    mark,
    ownerNodeId: owner.id,
    range: { from: { path: [...pos.path], offset: from }, to: { path: [...pos.path], offset: to } },
  };
};
```

### `hard_break`

```ts
/** A hard break is one inline cursor unit and never carries marks itself. */
export const hardBreakNodeSpec = {
  type: "hard_break", group: "inline", atomic: true, selectable: false, marks: "",
} as const satisfies NodeSpec;
```

## B. Deviations from spec

1. **Canonical mark names use `bold` and `strike`, not the illustrative
   `strong`/tool spelling.** This matches the promoted root contracts and the
   existing codecs. Reversal later would touch schema data, codecs, adapters,
   and migrations: medium blast radius.
2. **Atom partial application is exposed through
   `reportMarkApplication(...)`, not by changing `MarkCommand`'s return type.**
   Commands still return exactly `SmartOperation[]`, preserving the Phase 3
   template. Reversing this would change every command caller: high blast
   radius. The separate read-only report is additive.
3. **Shift+Enter is owned at `keydown` as well as understood at
   `beforeinput`.** WebKit did not consistently emit `insertLineBreak` in the
   browser gate. `preventDefault()` at keydown avoids double insertion in
   browsers that would emit both. Reversal is local to the input adapter: low
   blast radius.
4. **The retained-legacy shadow corpus compares all twelve command tools but
   does not run a second legacy composition engine.** Marked composition is
   proven in the canonical pipeline in all three Playwright engines, while the
   legacy side is retained command/model code. Therefore the shadow claim is
   narrower than §2.7 requested. Reconstructing a truthful legacy native-IME
   engine is not possible with synthetic events: medium test-infrastructure
   blast radius, no runtime contract impact.
5. **Legacy-before-delete ordering is not verifiable.** No commit was made
   between retaining the harness and deleting the product paths. The current
   worktree contains the harness and git's current base still contains the
   deleted files, so their source is recoverable, but neither fact proves the
   required ordering. Gate 12 therefore fails rather than passing with a
   qualification. There are also no per-phase rollback or bisect points.
   Runtime blast radius: none; audit and recovery blast radius: high.
6. **ClassicEditor remains DOM-authoritative between inline operations.** The
   `canonical-inline-dom-roundtrip` adapter is migration scaffolding owned by
   Phase 8, not final architecture. Removing it requires canonical product
   authority: intentionally deferred, high implementation effort but no frozen
   interface change.

## C. Locked decisions

- **Toggle on mixed:** remove only for `coverage: "all"`; otherwise apply to
  the complete scope.
- **Ordering:** marks sort by type, then stable serialized attributes. Sorting
  occurs at operation/parse boundaries. Normalization merges only exact sets.
- **Attributes:** colors store lowercase hex; font sizes store finite CSS px;
  font families are trimmed, de-quoted, whitespace-normalized, lowercase;
  links store normalized safe href and trimmed target.
- **Self-exclusion:** font size, family, foreground, background, and link
  replace their own type. Superscript and subscript exclude one another.
- **Inclusivity:** every declared mark except link is inclusive. Link is
  non-inclusive at its end.
- **Atoms:** mark operations affect eligible text, skip disallowed atoms, and
  report skipped atom IDs separately.
- **Links:** collapsed removal and edit target the full exact-href run; ranged
  removal only affects the range; end typing is unlinked; interior typing is
  linked; equal adjacent hrefs merge; different hrefs do not; apply replaces
  existing link attrs; links cannot span owners; unsafe/malformed schemes are
  rejected.
- **Stored marks:** collapsed apply/toggle sets them; text/composition consumes
  them; selection change and non-consuming transactions clear them; transaction
  history restores them; toolbar description composes them at the call site.
- **Hard break:** one atomic inline unit, `selectable: false`, carries no marks.
  Legacy canonical newline text migrates on load.

## D. Exit gate results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `foundation/marks/marks.test.ts`: throwaway thirteenth declaration uses `executeMarkTool` and existing generic commands. |
| 2 | PASS | `foundation/marks/marks.test.ts`: mixed/all coverage, multi-owner runs, exclusions, inclusivity, and atom behavior. |
| 3 | PASS | Core multi-owner list fixture plus `canonicalInlineCommandBridge.test.ts` list/table fixture; contract grep finds no list/table branch in mark commands. |
| 4 | PASS | `foundation/marks/marks.test.ts`: 2,000 generated normalization cases, seed `0x4A4B2026`; local/idempotent/deterministic assertions. |
| 5 | PASS | Core link matrix and React adapter/browser coverage; URL policy has 18 security fixtures. |
| 6 | PASS | Stored-mark type/undo/redo property loop: 500 cases, seed `0x5704ED`; three-browser composition/history test. |
| 7 | PASS for synthetic browser automation; physical-device caveat | Token test in `foundation/phase2_5.test.ts`; marked composition in Chromium/Firefox/WebKit; zero composing DOM writes. Real Gboard/Safari IME is still unverified. |
| 8 | PASS | Core hard-break/migration fixture, full HTML round-trip, and three-browser Shift+Enter test. |
| 9 | PASS | `foundation/marks/formats.test.ts`: HTML full; Markdown degradation preserves text; DOCX semantic properties; PDF text-only declaration. |
| 10 | PASS | `lint:phase4-contract`, grep, and call-site review: product inline mutations route through `executeCanonicalInlineTool`; deleted legacy inline adapter modules are not imported. |
| 11 | **PARTIAL; owner accepted residual risk** | axe passes in all three browsers and mixed `aria-pressed` has a React test. Product-owner VoiceOver + Safari smoke passed on 2026-08-03, including dropdown keyboard operation via VoiceOver interaction mode. NVDA + Chrome remains pending. |
| 12 | **FAIL: ordering unverifiable** | Test-only legacy harness exists and covers twelve tools; lint prevents product import. No preceding retention commit exists, so the required ordering cannot be established from git history. |
| 13 | PASS for command corpus; narrower than requested for composition | Node: 3,000 cases, seed `0x1A4F2026`; browser: 1,000 per engine, same seed; zero divergences. Composition is canonical-vs-contract, not dual-engine. Catalogue: `PHASE_4_INLINE_BEHAVIOR_CHANGES.md`. |
| 14 | PASS, with explicit suite-deletion accounting | Phase 1 64→64; Phase 2 13→13; Phase 2.5 10→11 (one marked-token regression test added); Phase 3 core slice 29→29 and React list tests 37→38. React total 212→209 is explained by 22 removed obsolete tests and 19 additions/replacements, detailed below. Final full suites: core 315/315, React 209/209. Root build and all contract/TypeScript lints pass. |
| 15 | PASS | Active migration adapters: 1 after Phase 3 → 2 after Phase 4. This is the expected pre-peak increase; both are explicitly owned by Phase 8. |

Browser Phase 4 run: 9/9 tests. The preceding full-file run exposed and led to
the WebKit Shift+Enter fix. The retained Phase 2.5 10,000-block sample was then
19.7 ms Chromium, 10.0 ms Firefox, and 17.0 ms WebKit.

The 22 deleted React tests were:

- `coreBold.test.ts`: 5 tests for the retired bold feature flag/adapter;
- `inlineMarkCoreExecution.test.ts`: 10 tests for the retired per-mark adapter
  and compatibility flags;
- `internalFlags.test.ts`: 7 tests for retired inline migration flags.

Their behavior is replaced by 16 generic canonical bridge tests, one retained
legacy-harness test, one comparator corpus test, and one additional product/list
regression test: 19 additions. Future reports must list removed test files,
test counts, reason, and replacement coverage instead of relying only on totals.

## E. Known gaps and confidence limits

1. **Manual screen-reader coverage is incomplete:** VoiceOver + Safari passed
   the available-device smoke session; NVDA + Chrome remains pending and was
   explicitly accepted as residual risk for Phase 5 entry.
2. **Physical IME remains unverified:** Playwright proves ownership and marked
   reconciliation with synthetic composition. It cannot prove Gboard Hindi or
   Tamil, Samsung Keyboard, Safari Indic candidate windows, or CJK candidate UI.
3. **Shadow composition evidence is incomplete:** there is no retained native
   legacy IME engine. This is explicitly not presented as zero divergence.
4. **Atom-aware composition remains Phase 7:** marked text is tokenized; atoms
   and decorations inside a composing owner are not.
5. **Not all twelve tools have dedicated product toolbar affordances.** The
   generic engine and adapter support all twelve, but inline code in particular
   has no dedicated ClassicEditor toolbar button. This limits the literal
   “keyboard operation for all twelve tools” a11y claim.
6. React list tests emit pre-existing `act(...)` warnings. They pass, but the
   noise can obscure new warnings.
7. Chromium's 10,000-block input-to-paint measurement is close to the 20 ms
   assertion and produced one 20.5 ms sample before a 19.7 ms pass. Treat it as
   timer/layout noise, not a stable budget margin.
8. There are no phase/work-item commits. Deleted legacy sources remain
   recoverable from the current git base, but Phase ordering, rollback, and
   bisection are unavailable. Before Phase 5, create one honestly labelled
   accumulated baseline after validation; thereafter commit each work item and
   commit retained legacy harnesses before deletion in a separate commit.

## F. Shadow comparator results

- Node corpus: 3,000 scenarios, seed `0x1A4F2026`; equivalent 3,000;
  `expected-normalization` 0, `equivalent-serialization` 0,
  `selection-only` 0, `visual-only` 0, `semantic` 0, `data-loss` 0,
  `unknown` 0.
- Chromium: 1,000 scenarios; equivalent 1,000; all divergence classes 0.
- Firefox: 1,000 scenarios; equivalent 1,000; all divergence classes 0.
- WebKit: 1,000 scenarios; equivalent 1,000; all divergence classes 0.
- Logs contain structural hashes and classifications only. Text fixtures are
  asserted absent from serialized logs.

The full intentional behavior-change catalogue is
`docs/PHASE_4_INLINE_BEHAVIOR_CHANGES.md`: mixed toggles become uniform;
boundary affinity becomes deterministic; adjacent equal marks merge; color,
font size, and family values canonicalize; scripts become mutually exclusive;
link-end typing becomes unlinked; collapsed formatting uses editor state rather
than sentinels; Shift+Enter converges on `hard_break`; unsafe links are rejected.

The zero-divergence count applies to the retained command corpus. It must not be
read as physical-IME or dual-native-composition equivalence.

## G. Template assessment

Approximately **60%** of Phase 4 implementation effort reused the Phase 3
template: pure `(document, scope, params, ctx) → operations` commands,
caller-owned transactions, deterministic declarations, ID-backed scope lookup,
parse/command/render product scaffolding, structural normalization hooks,
hash-only comparator logs, retained test harness, behavior catalogue, and
adapter inventory/lint gates.

Approximately **40%** was mark-specific: interval splitting, canonical mark
sets and attributed values, exclusions/inclusivity, collapsed stored marks,
whole-link-run resolution, URL security, marked-token composition, hard breaks,
and run-property codecs.

The template itself needed two changes:

1. the shadow-before-delete rule became a machine-checked retained test harness;
2. partial application needed a separate read-only report so the pure command
   return type remained unchanged.

Prediction for Phases 5–8: the command/caller/history/comparator scaffolding is
real and should reduce setup cost. Phase 5 still has intrinsically new block
scope and structural semantics, while Phases 6–8 will be dominated by their
feature domains rather than by command plumbing. The DOM-roundtrip adapters are
reusable migration scaffolding only and must peak by Phase 6, then decline to
zero at Phase 8.

## H. Scope leakage

- No block-level feature was migrated.
- No clipboard parser was implemented; paste/drop ownership remains Phase 8.
- No atom-aware composition tokenization was implemented.
- No plugin runtime was implemented.
- Shared list HTML codecs were extended only to serialize/parse marks and
  `hard_break`; list behavior itself was not expanded.

The product owner explicitly approved Phase 5 entry on 2026-08-03 after the
available macOS/Safari session. Pending NVDA and physical-device IME checks stay
open and must not be described downstream as completed Phase 4 evidence.
