# Smart RTE Phase 5 — Block Transformation Engine Completion Report

Phase 5 is implemented and all automated stop conditions pass. The formal
phase gate is not entirely green: NVDA + Chrome manual validation (gate 13)
could not be performed on the available hardware. The recorded Safari
VoiceOver session is an operability pass and is not represented as proof of
announcement quality.

## A. Implemented interfaces (verbatim)

### `setNodeType`

From `foundation/types.ts`:

```ts
| { type: "setNodeType"; pos: SmartPos; before: string; after: string; beforeAttrs: Attrs; afterAttrs: Attrs }
```

Its command payload is emitted as:

```ts
operations.push({
  type: "setNodeType",
  pos: { path: [...pos.path, pos.offset], offset: 0 },
  before: node.type,
  after: params.type,
  beforeAttrs: node.attrs || {},
  afterAttrs,
});
```

### Block command set, context, and tool declaration

```ts
export interface BlockCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export type BlockCommand<P> = (
  document: SmartDocument,
  scope: ResolvedScope,
  params: P,
  ctx: BlockCommandContext,
) => SmartOperation[];

export interface SetBlockTypeParams { readonly type: "paragraph" | "heading" | "code_block"; readonly attrs?: Attrs }
export interface WrapBlocksParams { readonly type: "blockquote"; readonly attrs?: Attrs; readonly wrapperIds: readonly string[] }
export interface UnwrapBlocksParams { readonly type?: "blockquote" }
export interface SetBlockAttributesParams { readonly attrs: Attrs }
export interface MoveBlocksParams { readonly direction: "up" | "down" }
export interface IndentBlocksParams { readonly amount?: number }
export interface OutdentBlocksParams { readonly amount?: number }

export interface BlockToolDeclaration {
  readonly id: string;
  readonly kind: "setType" | "wrapToggle" | "setAttributes";
  readonly type?: "paragraph" | "heading" | "code_block" | "blockquote";
  readonly attrs?: Attrs;
  readonly nestable?: boolean;
  readonly validate?: (attrs: Attrs | undefined) => boolean;
}

export const blockCommands = {
  "block.setType": setBlockTypeCommand,
  "block.wrap": wrapBlocks,
  "block.unwrap": unwrapBlocks,
  "block.setAttributes": setBlockAttributes,
  "block.move": moveBlockCommand,
  "block.indent": indentBlockCommand,
  "block.outdent": outdentBlockCommand,
} as const;
```

The declarations are:

```ts
export const blockToolDeclarations = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `heading${index + 1}`,
    kind: "setType" as const,
    type: "heading" as const,
    attrs: { level: index + 1 },
    validate: (attrs: Attrs | undefined) => Number.isInteger(attrs?.level) && Number(attrs?.level) >= 1 && Number(attrs?.level) <= 6,
  })),
  { id: "paragraph", kind: "setType", type: "paragraph" },
  { id: "codeBlock", kind: "setType", type: "code_block" },
  { id: "blockquote", kind: "wrapToggle", type: "blockquote", nestable: true },
  { id: "alignLeft", kind: "setAttributes", attrs: { align: "left" } },
  { id: "alignCenter", kind: "setAttributes", attrs: { align: "center" } },
  { id: "alignRight", kind: "setAttributes", attrs: { align: "right" } },
  { id: "alignJustify", kind: "setAttributes", attrs: { align: "justify" } },
] as const satisfies readonly BlockToolDeclaration[];
```

### Generalized preceding-content helper

```ts
export interface ContentTargetContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export interface ContentTargetLineageEntry {
  readonly nodeId: string;
  readonly type: string;
}

export interface ResolvedContentTarget {
  readonly ownerId: string;
  /** Target-subtree lineage, outermost first and including the owner. */
  readonly lineage: readonly ContentTargetLineageEntry[];
}

export const resolvePrecedingContentTarget = (
  document: SmartDocument,
  nodeId: string,
  ctx: ContentTargetContext,
): ResolvedContentTarget | null => {
  const located = ctx.positions.positionOf(nodeId);
  if (!located) return null;
  let path = [...located.pos.path, located.pos.offset];
  const isolationPath = nearestIsolatingPath(document, path, ctx.schema);
  while (path.length > isolationPath.length) {
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    if (index > 0) {
      const sibling = nodeAtPath(document, [...parentPath, index - 1]);
      if (sibling && !isTextNode(sibling)) return deepestLastContentOwner(sibling, ctx.schema);
    }
    path = parentPath;
  }
  return null;
};
```

### Code-block node spec

```ts
{ type: "code_block", group: "block", content: "text*", marks: "", attributes: { ...blockAttrs, language: stringAttr }, defining: true }
```

## B. Deviations from spec

1. **Command export names are implementation-oriented.** The registry uses the
   specified public IDs, but functions are named `wrapBlocks`, `unwrapBlocks`,
   `setBlockAttributes`, `moveBlockCommand`, `indentBlockCommand`, and
   `outdentBlockCommand`. Reversal blast radius is low: the registry is the
   public command surface.
2. **Code-block escape uses only Ctrl/Cmd+Enter.** Enter on a trailing empty
   line was not also implemented. The chosen gesture is documented and tested.
   Reversal is additive and low blast radius.
3. **Code-block exit is position-sensitive.** Ctrl/Cmd+Enter at offset zero
   inserts a paragraph before; elsewhere it inserts one after. This makes
   opening and closing boundary code blocks escapable. Low reversal blast
   radius, but it is observable behavior.
4. **DOCX/PDF are canonical intermediate exports, not binary writers in this
   module.** DOCX maps block kind/style/alignment/indent (720 twips per level);
   PDF exports visual text. Existing format infrastructure owns packaging.
   Reversing the boundary would be medium blast radius.
5. **The general HTML/Markdown codec remains in the historically named
   `foundation/list/formats.ts`.** `foundation/block/formats.ts` exports the
   block-facing API. Moving it is low semantic but medium import churn.
6. **Shadow results include intentional `selection-only` divergences.** The
   retained legacy quote/code replacement does not preserve the semantic
   selection as precisely as the canonical bridge. These were classified and
   catalogued before deletion; they are not semantic or data-loss divergence.
7. **ClassicEditor remains DOM-authoritative between operations.** The block
   parse → command → render bridge is temporary migration scaffolding owned by
   Phase 8, not final architecture.
8. **Manual NVDA validation is absent.** This is not an implementation
   deviation, but it means gate 13 fails literally. There is no safe automated
   substitute or honest way to reverse that fact in code.

## C. Locked decisions

- **Indent/alignment:** `indentLevel` and `align` attributes on the block; no
  wrapper representation. Indent clamps to 0–10.
- **Quotes:** nestable; unwrap removes exactly one level. A quote over a list
  wraps the complete list shell.
- **Code escape:** Ctrl/Cmd+Enter. Offset zero exits before; any other offset
  exits after. A new paragraph ID is caller-supplied when determinism matters.
- **Code Tab precedence:** Tab inserts `"\t"` in code and never invokes block
  indentation.
- **Mixed setType:** requested type applies to every complete promoted block;
  it does not invert per block.
- **Mixed wrap toggle:** all already wrapped means unwrap one level; otherwise
  wrap all complete runs.
- **Marks on type change:** preserved for paragraph/heading transformations.
  Entering `code_block` explicitly removes marks because its schema says
  `marks: ""`.
- **Identity:** `setNodeType` preserves the node ID; inversion restores the
  original type and attributes without minting an ID.
- **Movement:** contiguous siblings move as one run; document boundaries are
  no-ops. Block and list movement use `moveContiguousSiblings`.
- **History:** structural transactions never coalesce. Selection direction,
  IDs, type, marks, and attributes restore through undo/redo.

## D. Exit gate results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `foundation/block/commands.test.ts`; heading levels 1–6 share one declaration path and alignment values share `setBlockAttributes`. |
| 2 | PASS | `foundation/foundation.test.ts`: operation matrices now include 12 ops; 1,000 inversion cases seed `0xC0FFEE`, 500 structural sequences seed `0x1D5`. Phase 1 file 64→67 tests. |
| 3 | PASS | `foundation/block/commands.test.ts`: 500 type/undo cases, seed `0xB10C500`; `domBlockCommandBridge.test.ts` asserts stable `data-smart-id`. |
| 4 | PASS | `foundation/block/commands.test.ts` and React bridge tests preserve strong/font-size/link runs across paragraph↔heading; code intentionally strips them. |
| 5 | PASS | Core 7-test block matrix, React 11-test bridge matrix, and three-browser product workflows. |
| 6 | PASS | `foundation/block/input.test.ts`, `foundation/phase2_5.test.ts`, and browser product/canonical paths cover newline, Ctrl/Cmd+Enter, Tab, boundaries, and plain fragments. |
| 7 | PASS | List-item/table-cell fixtures require no branches in block command code. Table cells remain isolating. |
| 8 | PASS | Both `moveBlockCommand` and `moveListItems` call `moveContiguousSiblings`; dedicated unit assertion compares their `moveNode` behavior. |
| 9 | PASS | Shared `foundation/structural/contentTarget.ts`; list input delegates to it and cross-parent lineage is separately tested. |
| 10 | PASS | Quote/list-shell and imported-list repairs are deleted. The final table-from-list normalizer was also removed; grep finds no `LEGACY_LIST_TOUCHPOINT` or list-restructuring normalizer in ClassicEditor. |
| 11 | PASS | Product type, quote, code, align, indent/outdent, and block movement route through the canonical block bridge. Grep finds no `formatBlock`, tag replacement fallback, or legacy block normalizer. |
| 12 | PASS | `foundation/block/formats.test.ts` (3): HTML full, Markdown semantic degradation, DOCX semantic mapping, PDF text-only. |
| 13 | **FAIL — manual dependency** | Automated semantics/axe pass in Chromium, Firefox, and WebKit. Safari VoiceOver operability passed on 2026-08-03. NVDA + Chrome was not performed; announcement quality is not inferred. |
| 14 | PASS | `070ed1a` retained the legacy engine; `8f6fd98` completed comparison/catalogue; `1ee9de7` deleted block paths. Git order is machine-verifiable. |
| 15 | PASS | Node 3,000 cases seed `0xB10C2026`; browser 1,000/browser. No semantic/data-loss divergence; selection-only entries are catalogued. |
| 16 | PASS | Phase 1 64→67; Phase 2 13→13; Phase 2.5 11→12; Phase 3 core 29→29 and React list 38→38; Phase 4 core mark/format 15→15. Totals: core 315→332, React 209→218. **Removed Phase 5 tests: none.** Final browser suite: 132/132. |
| 17 | PASS, warning triggered | Five standalone samples/browser recorded below. Chromium crossed the investigation threshold for the first successive phase. |
| 18 | PASS | Active adapters 2→3; inventory declares Phase 5 as the peak. Phase 6 must not increase the count; all three are owned by Phase 8. |

The stop conditions (2, 3, 14, 16) all pass. Gate 13 remains a formal manual
failure even though it is not listed as a stop condition.

Gate 17 standalone five-sample results at 10,000 mounted blocks:

| Browser | Raw samples (ms) | Median | p95 | Worst |
|---|---|---:|---:|---:|
| Chromium | 41.9, 24.0, 23.1, 28.8, 19.5 | 24.0 | 41.9 | 41.9 |
| Firefox | 14, 11, 12, 10, 10 | 11.0 | 14.0 | 14.0 |
| WebKit | 25, 23, 19, 18, 17 | 19.0 | 25.0 | 25.0 |

The concurrent full-suite rerun was noisier (Chromium median/worst 21.1/43.3,
Firefox 18/42, WebKit 21/33), confirming these headless development-build
figures are trend signals rather than production budgets. The Phase 5
standalone run is the tracked series. If Phase 6 crosses the threshold again,
the documented two-successive-phase rule pulls the `content-visibility`
investigation forward.

## E. Known gaps and confidence limits

1. **NVDA + Chrome is untested.** VoiceOver verified selection, editing,
   undo/redo, toolbar, and dropdown operability only. It did not separately
   record concise list-level announcements, checkbox/list-item dual semantics,
   mixed toolbar announcements, heading outline narration, or code-language
   narration.
2. **Physical Indic/CJK IME remains untested.** Synthetic three-browser
   composition suites pass; Gboard/Samsung/Safari Indic/CJK candidate windows
   remain owner-accepted residual risk.
3. **React list tests emit pre-existing `act(...)` warnings.** They pass, but
   the noise can hide a future warning.
4. **ClassicEditor is still DOM-authoritative.** Three adapters remain and must
   reach zero by Phase 8.
5. **Table-only direct cell alignment and bare-cell materialization remain,**
   explicitly owned by Phase 6. They no longer restructure list shells.
6. **Generic atom/media movement remains legacy until Phase 7.** Ordinary
   block and list movement use the shared canonical implementation.
7. **10,000-block Chromium rendering is now over the trend trigger.** Model
   work is still sub-millisecond; browser DOM/layout/paint dominates.

## F. Shadow results and behavior-change catalogue

Node corpus: 3,000 scenarios, seed `0xB10C2026`; 2,142 exact and 858
`selection-only` (429 quote, 429 code), zero semantic, zero data-loss.

Browser corpus per engine:

| Browser | Scenarios | Exact | Selection-only | Semantic | Data-loss |
|---|---:|---:|---:|---:|---:|
| Chromium | 1,000 | 714 | 286 (143 quote, 143 code) | 0 | 0 |
| Firefox | 1,000 | 714 | 286 (143 quote, 143 code) | 0 | 0 |
| WebKit | 1,000 | 714 | 286 (143 quote, 143 code) | 0 | 0 |

Logs contain only structural hashes and classifications. The full pre-deletion
catalogue is `PHASE5_BLOCK_BEHAVIOR_CHANGES.md`. Intentional changes are:

1. paragraph↔heading preserves ID and marks;
2. code conversion strips marks and emits semantic `pre`/`code`;
3. alignment/indent are canonical attributes;
4. quote unwrap removes one level;
5. selecting list content quotes the entire list shell;
6. movement past boundaries is a no-op;
7. code Enter/Tab/Ctrl-or-Cmd+Enter are model-owned;
8. canonical quote/code selection restoration is more precise than retained
   legacy replacement;
9. block alignment targets a block inside a list item, not the `li` itself;
10. imported per-item marker styles no longer override a newly selected list
    hierarchy style.

## G. Template assessment

Approximately **65%** of the implementation reused the Phase 3/4 template:
pure `(document, scope, params, ctx) → SmartOperation[]` commands, declarative
tools, caller-owned transactions/IDs, shared scope lookup, structural history,
format fixtures, retained legacy comparator, hash-only logs, and the temporary
product bridge.

About **35%** was block-specific: identity-preserving type change, wrapper
semantics, code input/escape, attribute indentation, and format mappings.

The §1.2 generalization held. `resolvePrecedingContentTarget` is schema-driven,
crosses parent boundaries in logical order, returns lineage, and stops at the
nearest isolating ancestor. The movement generalization also held: lists and
blocks share one implementation. Phase 6 will still be structurally expensive
because logical grids/spans are genuinely new; Phase 7 and Phase 8 should reuse
most of this template.

## H. Scope leakage

- No table grid engine was implemented. Only existing table fixtures and
  Phase-6-labelled cell touchpoints were preserved.
- No atom/media migration was implemented.
- No clipboard parsing was implemented. Code accepts canonical fragments and
  reduces them to plain text; Phase 8 still owns parsing.
- No plugin runtime work was added.
- No virtualization or content-visibility architecture change was made.

The only adjacent corrections were frozen-suite regressions discovered by the
full browser run: accessible-name preservation, canonical mixed `aria-pressed`,
and depth-aware imported list marker cleanup. They restore prior contracts and
do not migrate a new feature family.
