# Table / color-picker / table-Tab audit

**Type:** Investigation only. No fixes were made in this pass except one trivial,
fully-isolated item noted explicitly under "Fixed incidentally" — everything else
below is a finding for a **separate, later** fix pass, not a diff.

**Scope:** (1) full lifecycle of every `table`/`table_row`/`table_cell` schema
attribute; (2) re-verification of resize, merge, split, and header; (3) full
lifecycle trace of `ColorPickerPopover` across all four call sites; (4) the
Tab-inside-nested-list-inside-a-table-cell dispatch chain; (5) synthesis and
severity ranking.

`docs/bugs/` was checked before starting, per the standing project rule. Two
entries are directly relevant and are reconciled explicitly in §3 and §4 rather
than re-litigated from zero.

---

## §1. Table attribute lifecycle

### 1.1 Attribute-by-attribute table

Columns: **Settable** = a command exists that a UI action actually invokes to
change this attribute after creation. **Parseable** = HTML/DOCX import produces
this attribute from real markup. **Rendered** = the renderer applies the
attribute's current value to the live DOM.

| Node | Attribute | Settable | Parseable | Rendered | Notes |
|---|---|---|---|---|---|
| `table` | `columnWidths` | Yes — `table.setColumnWidth` (`TableResizeHandles.tsx`) | Yes — `parsePixelWidth`, all-or-nothing (`list/formats.ts`) | Yes | Previously "yes/yes/no"; fixed across rounds 1–3. |
| `table` | `caption` | **No** — no command exists anywhere; `grep` of `table/commands.ts` for `caption` turns up only import/serialize | Yes — `list/formats.ts:379-380` | Yes — `surface/renderer.ts:183-194` | Round-trips through paste/import/export correctly, but a user can never add, edit, or remove a caption from inside the editor. |
| `table` | `layout` | **No** — only ever set once, hardcoded to `"fixed"`, inside `insertTableCommand` (`table/commands.ts:94`); no command changes it afterward | Yes — `list/formats.ts:381-382` (`data-smart-layout` attr or `table-layout` style) | Yes — `surface/renderer.ts:178-181` | Same shape as `caption`: real data path in and out, but no in-editor way to change it once a table exists. |
| `table_row` | `height` | Yes — `table.setRowHeight` (`table/commands.ts:373`) | Yes, **but unvalidated** — `list/formats.ts:387` uses a bare `Number.parseFloat(styleValue(node,"height") \|\| attr(node,"height") \|\| "")` with no unit check | Yes — `surface/renderer.ts:244-247` | See §1.3 — this is the exact bug class `parsePixelWidth` was built to close for `columnWidths`, not yet applied here. |
| `table_cell` | `colspan` / `rowspan` | Yes — `table.mergeCells` / `table.splitCell` | Yes — standard `colspan`/`rowspan` HTML attrs | Yes — `surface/renderer.ts:262-265` | Fully wired. |
| `table_cell` | `header` | Yes — `table.setHeader` (row/column/none) | Yes | Yes — tag swap `td`↔`th` via the diff loop's tag-mismatch replacement (`surface/renderer.ts:495-544`) | Fully wired; re-verified this pass (§1.2). |
| `table_cell` | `background` | Yes — `table.setCellAttributes` (context-menu "Cell background colour") | Yes | Yes | Fully wired. |
| `table_cell` | `textColor` | Yes — `table.setCellAttributes` (context-menu "Cell text colour") | Not independently checked this pass (behavior consistent with `background`'s import path in the same function) | Yes — fixed in round 2 | **Absent from the `table_cell` `NodeSpec`** in `table/schema.ts` entirely (see §1.4) despite being fully functional. |
| `table_cell` | `borders` | Command-layer only — `table.setCellAttributes` accepts an arbitrary `attrs: Attrs` dict (`table/types.ts:69`) so it *could* set this key, but **no UI action anywhere ever calls it with `borders`** | Yes — `list/formats.ts:399,403` | Yes — `surface/renderer.ts:267` | Real data in and out; genuinely un-reachable from any exposed UI action, same shape as `caption`/`layout`. |
| `table_cell` | `verticalAlign` | Same as `borders` — command-layer generic, no UI ever sets it | Yes — `list/formats.ts:401,405` | Yes — `surface/renderer.ts:268` | Same shape as `borders`. |

### 1.2 Merge / split / header re-verification

Not reported broken, but not independently re-verified across the three
surrounding rounds of table/color-picker work. Re-verified this pass by reading
current code (not re-running fresh manual tests, since the relevant commands
were untouched by any of the three bug-fix rounds — confirmed by checking which
files each round's report actually modified):

- **Merge** (`mergeTableCellsCommand`, `table/commands.ts:241`): rejects merging
  cells with mixed `header` status via `headers.size > 1` at line 249 — correct,
  matches the test name `"merges in reading order, rejects a header boundary,
  and splits without pretending to invert merge"` (`table.test.ts:125`).
- **Split** (`splitTableCellCommand`, `table/commands.ts:291`): preserves the
  anchor cell's `header` attr onto the split-off cells (`line 298`) — correct.
- **Header** (`table/commands.ts:~330-337`): computes the target `header` value
  from `params.target` ("row"/"column"/"none") and no-ops if the value wouldn't
  change (`line 336`) — correct. Rendering is handled by the tag-mismatch
  fallback in the diff loop (`surface/renderer.ts:495-544`, confirmed
  structurally sound: HTML cannot rename an element's tag in place, so falling
  through to full create-and-replace is the only correct option, not a
  workaround).
- **Confirmation via test suite**: `pnpm --filter core test` → **613/613
  passing**, including the merge/split/header unit tests above, run fresh in
  this audit session (not assumed from a prior round's report).

No regression, no behavior change, no new finding in merge/split/header
specifically — current behavior is confirmed correct.

### 1.3 Resize: live-preview / commit-on-release soundness

The live-preview/commit-on-release split (added round 1, refined round 3) is
structurally sound for the **happy path**: `TableResizeHandles.tsx` mutates real
`<col>`/`<tr>` DOM directly during the drag for visual feedback, and commits via
`onResizeColumn`/`onResizeRow` only on `"pointerup"`, seeded with the real
current widths (`columnsRef.current.map(b => b.size)`) so sibling columns are
never reset to a fabricated default (round 3's fix).

**New finding — no interrupted-drag handling.** `grep -n
"Escape|pointercancel|blur|visibilitychange" TableResizeHandles.tsx` returns
zero matches. If a drag is interrupted — browser cancels the pointer capture,
the tab loses focus, `Escape` is pressed, or the OS/browser fires
`pointercancel` for any reason — there is no handler for any of it. Concretely:

- `dragRef.current` stays permanently set to the interrupted drag, so the next
  *unrelated* pointer movement over the resize-handle layer is misinterpreted
  as a continuation of the old drag.
- The live-preview inline styles applied directly to the DOM during the drag
  are never rolled back and never committed — the table visually shows a
  resized column/row that does not exist in the model, until some unrelated
  future render happens to re-sync the colgroup from real model state.

This is a real, previously-unreported gap in the "structurally sound" resize
split — see §4 for severity ranking.

### 1.4 Schema-permissiveness confirmation

`packages/core/src/foundation/schema.ts`'s `validateAttributes` (~lines
125-139) iterates only over the schema's own **declared** attribute specs; it
never checks whether a node's actual `attrs` contain a key that isn't declared.
This is confirmed to be why `table_cell.attrs.textColor` works end-to-end
(settable, parseable via the same path as `background`, rendered) despite never
appearing in `table/schema.ts`'s `table_cell` `NodeSpec`. Not a bug by itself —
schemas are additive/permissive by design — but it means "declared in the
schema" is not a reliable signal for "this attribute is real," which is
directly relevant to the structural fix proposed in §4.

---

## §2. Color picker lifecycle

### 2.1 Component-internal trace (`ColorPickerPopover.tsx`)

Every path in the component was traced for a second premature-commit/close
path (the native `<input type="color">` had exactly this bug, fixed round 3):

| Action | Effect | Commits? |
|---|---|---|
| Native color input `onChange` | `setHex(value)` only | No — stage only |
| Hex text input `onChange` | `setHex(value)`, clears error | No — stage only |
| `Enter` (root `onKeyDown`, lines ~132-135) | `apply(hex)` | **Yes** |
| "Apply" button (`onClick`, lines ~195-201) | `apply(hex)` | **Yes** |
| `Escape` (root `onKeyDown`, lines ~128-131) | `onCancel()` | No — discards |
| "Cancel" button | `onCancel()` | No — discards |
| "×" close button | `onCancel()` | No — discards |

No second premature-commit/premature-close path exists. `apply()` itself
(lines 95-101) validates against `HEX_PATTERN` before calling `onApply` —
an invalid hex value cannot commit regardless of entry path. The
Enter-submits / Escape-cancels convention is deliberate and consistent with
`LinkEditorPopover`'s own pattern. **§2's specific ask ("confirm there isn't a
second premature-commit path anywhere") is answered: no.**

### 2.2 Call-site consistency (all 4 sites)

All four sites route through the same two functions with no divergence:

- **Toolbar text/background colour** (`CanonicalAuthorityEditor.tsx:802-808`):
  one shared `onClick` branch for both `tool.id === "textColor"` and
  `"backgroundColor"`, both opening `{ target: { kind: "mark", markId:
  tool.id } }`.
- **Cell background colour** (context menu, `:566-568`) and **cell text
  colour** (context menu, `:571-573`): both open `{ target: { kind: "cell",
  attr: ... } }`.
- All four converge on the single `applyColor` function (`:384-397`), which
  branches only on `target.kind` — `"mark"` calls `applyMarkAttrs` (a mark
  operation), `"cell"` calls `setTableCellAttributesCommand` (a table
  operation) — both paths call `setColorPopover(null)` identically on
  completion, and both are wrapped in the same `runtime.executeOperations`
  convention (`{ preserveSelectionById: true }` for the cell path;
  `applyMarkAttrs` uses `executeMarkTool` for the mark path, its established
  equivalent).

**The round-2 reuse of `ColorPickerPopover` for cell-level color did not
introduce any divergence** between the toolbar and context-menu invocation
paths — this closes out §2's explicit reuse-consistency question.

### 2.3 New finding — the popover never receives the current color

`ColorPickerPopoverProps` declares `initialValue?: string` (line 7 of the
component), defaulting to `"#000000"` when omitted (line 59). **None of the
four `setColorPopover(...)` call sites, nor the component's own mount at
`CanonicalAuthorityEditor.tsx:921-929`, ever pass `initialValue`.** This isn't
a missed prop-pass at the JSX level — the `colorPopover` state's `target` union
(`:180-183`) carries no current-color field at all, so there is nothing
available to thread through even if the JSX did pass it.

**Effect:** every time any of the four color pickers opens — whether the mark
or cell already has a real, non-default color applied — the picker always
starts from `#000000`. The user has no way to see the color they're currently
editing, and if they submit without deliberately re-picking (e.g. hit Enter or
Apply by habit, or misclick "Apply" thinking it's adjacent to "Cancel"), the
real color is silently overwritten with black. Undo recovers it, so this is
not unrecoverable data loss, but it is a real, silent, previously-unreported
functional defect — not a divergence between call sites (all four share it
identically), but a shared gap in all four.

---

## §3. Tab inside a nested list inside a table cell

**Reconciling with `docs/bugs/` first, per the standing rule:**

- `docs/bugs/nested-list-in-table-cell-not-reproducible.md` (status: needs
  re-verification) is about **list creation** inside a cell — a different
  symptom. Not the same bug as this report, which is about **Tab-to-indent**
  once a nested list already exists. Noted per CLAUDE.md's "(c) different bug
  that merely looks similar" — not conflated with the current report.
- `docs/bugs/tab-key-loses-editor-focus-when-indent-declines.md` (status:
  Fixed) explicitly documents that its fix was **deliberately scoped to
  exclude table cells** — "`preventDefault()` now fires unconditionally
  whenever the cursor is in a list item and **not inside a table**." This
  confirms "table always wins Tab inside a cell" is a known, intentional,
  cross-referenced design decision from that earlier fix, not an accident —
  directly relevant precedent, reconciled explicitly here rather than treated
  as a fresh mystery.

### 3.1 Exact dispatch trace

`packages/core/src/foundation/surface/input.ts`, Tab handler, lines 1359-1411:

1. Line 1362: `const inTable = "inTable" in description && Boolean(description.inTable);`
   — `description.inTable` comes from `resolveScope({want:"describe"})`
   (`scope/resolveScope.ts:830`) and is typed (`scope/types.ts:116`) as
   `{ tableId: string; cellId: string } | null` — **a binary "is there any
   ancestor table_cell at all" flag, with zero depth or nesting information.**
   It cannot distinguish "caret in the cell's own paragraph" from "caret
   nested arbitrarily deep inside a list inside that cell."
2. Line 1373: `resolveShortcut(...)` is invoked — the Tier 0 data-driven
   dispatcher that tries each registered Tab contribution in priority order,
   actually resolving its declared scope and running its real command.
3. **Line 1376 — the short-circuit:** `if (inTable && (shortcut.commandId ===
   "list.indent" || shortcut.commandId === "list.outdent")) return null;` —
   this runs **before** any scope resolution happens for the list
   contribution. It blocks list Tab handling purely on the coarse `inTable`
   flag, without ever asking whether the caret is actually in the cell's own
   content or nested inside a list within it.
4. Lines 1396-1404: immediately below, `listItemAt(this.editor.document,
   active)` — a helper that **can** determine whether the caret is inside a
   list item — is already in scope and already called, just for a different
   purpose (the "always preventDefault in a list item, or focus silently
   leaves the editor" fallback at line 1401, itself gated `!inTable`).
5. Lines 1405-1409: once list contributions are blocked, `inTable &&
   description.inTable` falls through to `handleTableTab(...)` — ordinary
   cell-to-cell Tab navigation.

**Direct answer to the audit's question:** the dispatcher is **not even asked**
to consider the list plugin's Tab contribution when the caret is inside a table
— line 1376 blocks it unconditionally before `resolveShortcut`'s own
scope-resolution machinery (which otherwise would have correctly disambiguated
this exact case) ever gets a chance to run. This means a Tab press with the
caret nested inside a list, inside a table cell, is indistinguishable at this
gate from a Tab press directly in the cell's own paragraph — both hit line
1376's short-circuit and both are handed to the table, even though `listItemAt`
— which could disambiguate them — is already computed three lines away for an
unrelated check in the same function.

### 3.2 Same class of gap as Tier 0's `ScopeKind` finding?

**Yes, explicitly.** `resolveShortcut`'s own doc comment
(`plugin/dispatch.ts:24-27`) states the exact reason it exists: *"ScopeKind
alone cannot distinguish every case a real shortcut cares about (e.g. 'inside a
code block' and 'inside a plain paragraph' are both 'block-range')."* The
`inTable` short-circuit at `input.ts:1376` reintroduces precisely that same
shape of coarseness one layer up the same function: `inTable` alone cannot
distinguish "in the cell's own paragraph" from "nested in a list within the
cell" — both collapse to the same boolean, exactly as "code block" and "plain
paragraph" used to both collapse to the same `ScopeKind`. The dispatcher that
was built specifically to escape this class of problem is bypassed by its own
caller's pre-filter before it gets a chance to apply that fix to itself.

This is not a fresh architectural discovery — the code's own comment at lines
1363-1372 acknowledges the simplification directly ("`inTable` short-circuits
list contributions specifically... exactly as the old chain did"), meaning it
was a **known, deliberate compromise carried forward from the pre-Tier-0
hardcoded chain**, not an oversight introduced by later table/color-picker
work. But a concrete symptom has now surfaced from it, which makes it a real,
reportable finding regardless of how deliberate its origin was.

### 3.3 What a fix would look like (not implemented, per audit scope)

The building block already exists in the same function: replacing line 1376's
bare `inTable` check with something that also consults `listItemAt` (already
called at line 1401) — e.g. only blocking `list.indent`/`list.outdent` when
`inTable` is true **and** the caret is not inside a list item nested within
that cell — would let `resolveShortcut`'s real scope resolution decide the
list-vs-table question the way it already correctly decides code-block-vs-
paragraph elsewhere. This is deliberately not implemented in this pass.

---

## §4. Synthesis

### 4.1 One core-level gap, or unrelated clustering?

**Both, but weighted toward one real core-level gap.** Two genuinely distinct
issues are present:

1. **The "written, never verified against its own contract" pattern** —
   §1's attribute table shows this is not a two-instance coincidence
   (`columnWidths`, `textColor`) but a recurring shape: `caption` and
   `layout` are fully wired for import/render but have no settable command;
   `borders`/`verticalAlign` are fully wired for import/render but no UI ever
   invokes the (already-generic) command that could set them; `table_row.height`
   repeats the exact unvalidated-unit parsing bug `parsePixelWidth` was built
   to close, just in a different file. §1.4 confirms *why* this class of gap
   is easy to introduce silently: the schema's own attribute validation is
   permissive by design and never flags an attribute that's real but
   undeclared, or declared-but-unreachable from any UI action. **This is a
   real, single, structural root cause** — nothing in this codebase currently
   checks "does every schema attribute have all three legs (settable /
   parseable / rendered) genuinely reachable," so each new attribute silently
   inherits whichever subset of the three its author happened to wire.
2. **The Tab dispatch gap (§3) and the resize interrupted-drag gap (§1.3) are
   a different shape of issue** — not missing wiring, but a caller
   short-circuiting past a dispatch/robustness mechanism that already exists
   and already correctly solves the general problem elsewhere. These cluster
   with §1/§2 by *location* (recent work concentrated in table + color-picker
   code) but not by *mechanism* — they are not instances of the "three-legged
   attribute" pattern.
3. **The color-picker initial-value gap (§2.3)** is its own third shape:
   correct component behavior, correct reuse across call sites, but a shared
   state-design gap (no current-color field ever captured) — not an attribute
   lifecycle problem and not a dispatch problem.

So: one real structural root cause explains the majority of §1's findings and
is worth a structural fix; §2.3, §3, and the resize-cancel gap in §1.3 are
genuinely different mechanisms that happen to cluster in the same recently-
touched area, and would each need their own fix.

### 4.2 Proposed structural fix for the attribute-lifecycle gap (not implemented)

Two complementary options, either indepedently valuable:

- **A lint/contract check**: a test (or build-time check) that, for every
  `NodeSpec` in the schema, cross-references (a) the attribute keys the
  renderer's node-specific branch actually reads (statically greppable per
  node type) against (b) the attribute keys declared in that `NodeSpec`'s
  `attributes` map — failing when a declared attribute is never read by the
  renderer (`columnWidths`/`textColor`'s original bug) or flagging (as a
  warning, since it's legitimate) when a renderer-read attribute isn't
  declared (`textColor`'s current state). This directly targets §1.4's
  "schema declaration isn't a reliable signal" finding.
- **A documented "adding a new table/cell attribute" checklist** (e.g. in
  `table/README.md` or a comment block at the top of `table/schema.ts`) that
  lists all three legs — schema declaration, import parsing, command to set
  it, renderer application — as required steps, not implicitly assumed from
  "I added the attribute." Lower-effort than the lint check, catches the
  same class of gap earlier (at review time) rather than by accident months
  later.

### 4.3 Severity ranking (all findings, independent of fix difficulty)

**Functional breakage / silent incorrect state:**

1. **Color picker never shows the current color, silently overwrites on
   submit-without-changing** (§2.3) — every one of the 4 call sites; a plain,
   easily-triggered interaction (open picker, hit Enter or Apply out of habit)
   silently replaces a real color with black. Recoverable via undo, but the
   loss is silent and the user has no visual cue it happened.
2. **Resize drag has no interrupted-drag handling** (§1.3) — an interrupted
   drag leaves `dragRef.current` stuck (misattributes future unrelated pointer
   movement to the old drag) and leaves live-preview DOM mutations uncommitted
   and unreverted, visibly diverging from model state until an unrelated
   re-render happens to fix it.
3. **`table_row.height` import parsing uses unvalidated units** (§1.1/§1.3)
   — the exact `parsePixelWidth`-class bug, unfixed for row height: a
   percentage, point, or other non-pixel height value from pasted/imported
   HTML would be silently misread as a literal pixel count.

**Incorrect-but-recoverable / missing capability (no data corruption, but a
real gap):**

4. **Tab does not reach nested-list indent inside a table cell** (§3) — a
   real, reproducible precedence gap, but the fallback behavior (table
   cell-to-cell Tab navigation) is itself coherent, not corrupting, and the
   underlying mechanism to fix it correctly already exists unused three lines
   away.
5. **`table.caption` has no settable command** (§1.1) — round-trips correctly
   through import/export, simply unreachable from in-editor UI.
6. **`table.layout` has no settable command after creation** (§1.1) — same
   shape as caption.
7. **`table_cell.borders` / `table_cell.verticalAlign` have no UI path**
   (§1.1) — command-layer plumbing already generically supports them; only
   the UI action is missing.

**Cosmetic / documentation-only:**

8. **`table_cell.textColor` undeclared in the schema's `NodeSpec`** (§1.4) —
   fully functional end-to-end; purely a documentation/discoverability gap in
   the schema itself, with no behavioral consequence given the schema's
   permissive validation design.

### 4.4 Fixed incidentally

None. Every finding above requires either new UI (color-picker current-value
threading, caption/layout/borders/verticalAlign commands+UI), a genuine
behavioral change to a dispatch precedence rule (§3), or a parser fix with its
own test coverage need (`table_row.height`) — none qualified as "trivial and
clearly isolated" under this pass's explicit no-fix instruction, so nothing
was changed in the codebase during this audit.

---

## Verification performed during this audit

- `pnpm --filter core test` → 613/613 passing (fresh run, not assumed from a
  prior round).
- All findings above are cited to specific file:line locations, confirmed by
  direct reading of current source, not inferred from prior rounds' reports.
- `docs/bugs/` checked before starting; both relevant existing entries
  (`nested-list-in-table-cell-not-reproducible.md`,
  `tab-key-loses-editor-focus-when-indent-declines.md`) are explicitly
  reconciled in §3 rather than re-investigated from zero.
- No `docs/bugs/` entries were created or modified in this pass — per the
  standing rule, entries are written when a bug is fixed or confirmed not to
  be one; every finding here is open and deferred to the follow-up fix pass,
  where each will get its own ledger entry as it's resolved.
