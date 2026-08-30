# Sootr migration readiness assessment — 2026-08-30

**Scope note (per the requesting prompt):** this is investigation and planning only. No migration code, Sootr-side changes, or editor-side fixes ship in this pass. Sootr's codebase (`/Users/ayushbajpai/Developer/sootr-vetkai`) was directly accessible and was read directly — this is not a from-memory or Smart-RTE-side-only inference.

**Headline finding, stated first:** Sootr currently runs `smartrte-react@0.3.4` — the last pre-canonical, DOM-authoritative published version — via a single integration file, `app/components/RichTextEditor.tsx`. Its real usage is narrow and consistent (5 real call sites, all following one of three patterns), which is good news for scoping this migration. But the integration relies on **three assumptions about the old editor's API that the new editor genuinely does not honor**: a controlled `value` prop, a string-typed `onChange` callback, and a `MediaManagerAdapter`-shaped media integration. None of these are exotic edge cases — they are exercised by ordinary, everyday flows (loading an existing block, saving any edit, uploading any image). **This is not ready for a drop-in swap.** It is ready for a scoped adaptation effort with a clear, bounded list of changes, detailed below.

---

## 1. Inventory: what Sootr actually uses

### 1.1 The integration point

`app/components/RichTextEditor.tsx` is the **only** file that imports from `smartrte-react` (confirmed: `grep -rl "smartrte-react"` across Sootr's `app/` finds no other importer). It wraps `ClassicEditor` (dynamically imported, SSR disabled) and re-exports `MediaItem`, `MediaSearchQuery`, `MediaManagerAdapter` types from the package. All 5 real usage sites go through this one wrapper, not `smartrte-react` directly.

### 1.2 Props Sootr's wrapper passes to `ClassicEditor` today

From `RichTextEditor.tsx:216-228`:

| Prop | Type/value passed | Old editor's role |
|---|---|---|
| `value` | `normalizedValue` (a **string**, HTML) | Controlled content — editor re-syncs when this prop changes after mount |
| `onChange` | `handleChange`, typed `(html: string) => void` | Fires on every edit with the current HTML **string** |
| `placeholder`, `minHeight`, `maxHeight`, `readOnly` | plain values | Cosmetic/behavioral passthroughs |
| `table` | boolean (`enableTable`) | Toggles the table toolbar/insert-table capability |
| `media` | boolean (`enableMedia`) | Toggles media insert capability |
| `formula` | boolean (`enableFormula`) | Toggles formula insert capability |
| `mediaManager` | a `MediaManagerAdapter` object (from `createDefaultMediaManager()`) or `undefined` | Batch-upload/search object: `{ upload(files: File[]): Promise<MediaItem[]>, search(query): Promise<MediaItem[]> }` |
| `theme` | `resolvedTheme` (`"light" | "dark"`, from Sootr's own `useTheme()`) | Drives the editor's dark/light rendering |

### 1.3 Real usage sites (5 total, 3 distinct patterns)

Found by `grep -rl "RichTextEditor"` across Sootr's `app/`, excluding the wrapper itself:

| Context | File | `enableTable` | `mediaManager` | Notes |
|---|---|---|---|---|
| **MCQ** (question/explanation) | `app/components/MCQFormDialog.tsx:1094,1164` | `false` | `imageMediaManager` (wired, `useMemo`-created) | Two editor instances per form (question + explanation) |
| **Anomaly question** (question/explanation) | `app/components/anomaly.tsx:675,697` | `false` | `imageMediaManager` (wired) | Same shape as MCQ |
| **PYEQ** (previous-year exam question) | `app/components/PYEQFormDialog.tsx:149` | `false` | **not passed at all** | Confirmed: relies on the base64-data-URL-on-save fallback (`RichTextEditor.tsx`'s `createDefaultMediaManager`'s non-image branch, `mediaItem.url = <data: URL>`, later resolved by `prepareEditorHtmlForSave` at save time) |
| **Study material block** (edit existing) | `.../blocks/[blockId]/page.tsx:558` | `true` | `mediaManager` (`useMemo(() => createDefaultMediaManager(), [])`) | Only context with `enableTable` on; also passes `readOnly={isEditorLocked}` |
| **Study material block** (create new) | `.../blocks/new/page.tsx:283` | `true` | `mediaManager` (same pattern) | Same as above minus the lock |

**Pattern summary**: question-style content (MCQ/Anomaly/PYEQ) deliberately disables tables and wants media+formula; only the study-material block editor wants tables. This is a real, deliberate product distinction, not an oversight — the readiness plan below treats it as a hard requirement, not a nice-to-have.

### 1.4 Content lifecycle Sootr depends on

Traced through the block-edit page (`.../blocks/[blockId]/page.tsx`), the most complex real caller:

- **Initial load**: gated behind `isLoading` (line 418) — `RichTextEditor` is not mounted until the block's `html_content` has already been fetched and `setContent(block.html_content)` has run in the fetch's `onSuccess` (line 296). **This specific path is safe** even under an uncontrolled editor, since `content` already holds the real value at first mount.
- **Draft restore** (line 296-306, "Restore draft?" banner, lines 517-531): a user-facing button that calls `setContent(loadedDraft.content)` **while the editor is already mounted and showing the server-loaded content**. This is a genuine post-mount content replacement, not a first-mount value.
- **Every keystroke**: `handleContentChange` (line 337) calls `setContent(v)` and, if the server content has already loaded, `saveDraft(title, v)` — a live autosave-to-somewhere-local mechanism that depends on `v` being the actual current HTML string.
- **Save**: `apiService.updateBlock(..., { html_content: await prepareEditorHtmlForSave(content || '<p></p>') })` — depends on `content` (state driven by `onChange`) holding accurate HTML at click time.

### 1.5 Other integration logic in `RichTextEditor.tsx` worth flagging for §2/§3

- `stripInlineStyles` (line 654): an inline-style allowlist run on save, with **hardcoded substitutions for three of the old editor's CSS custom-property names** (`var(--srte-border)`, `var(--srte-border-light)`, `var(--srte-surface-subtle)`, `var(--srte-accent-bg)`) — a defensive measure against those variable references leaking into saved HTML from the old editor's live DOM (which *was* the model, so any inline style the DOM-authoritative renderer set could end up in `innerHTML`). Worth re-checking against the new editor's actual export output (see §3).
- `normalizeHtmlMediaSources`/`normalizeMediaUrl` (lines 416-443): rewrites relative/protocol-relative image `src` values before both display and save — content-shape-agnostic, should be unaffected by the editor swap.
- No custom toolbar contributions, no custom keyboard shortcuts, no `onFocus`/`onBlur` usage, and no other editor event beyond `onChange` were found anywhere in Sootr's codebase.

---

## 2. Capability mapping: old editor usage → new editor reality

| # | Sootr relies on | New editor's actual mechanism | Verdict |
|---|---|---|---|
| 1 | `value` as a **controlled** prop (editor re-syncs on external change) | `ClassicEditorProps`/`CanonicalAuthorityEditorProps` only accept `defaultValue` — read once at mount, never re-applied on change (confirmed: `ClassicEditorAuthority.tsx`'s wrapper only ever reads `props.defaultValue` at the initial render path, and `CanonicalAuthorityEditor` has no effect syncing content from a changing prop). Real, imperative re-sync is available via `SmartEditorHandle.replaceValue()` (obtained through a `ref`, since `ClassicEditor`/`ClassicEditorAuthority` is `forwardRef`-wrapped). | **Genuine gap.** Not a missing capability in the new editor (the imperative API exists) — a required **integration change**: `RichTextEditor.tsx` must accept/forward a `ref`, and callers needing post-mount content replacement (confirmed: only the block-edit page's "Restore draft" button) must call `ref.current.replaceValue(...)` instead of relying on the `value` prop. |
| 2 | `onChange: (html: string) => void` | `CanonicalAuthorityEditorProps.onChange` fires with a `SmartEditorChange` **object**, not a string. `ClassicEditorProps.onChange`'s own declared type is a union offering the old string signature — **but the actual implementation (`ClassicEditorAuthority.tsx`) always invokes it with the new object shape regardless**, a mismatch already flagged independently in this session's npm pre-publish audit (`docs/PHASE_PRE_PUBLISH_AUDIT.md` §7e). | **Genuine gap, and a confirmed-live one** — Sootr's actual `onChange={value => setForm(...)}`/`handleContentChange` callbacks across every single usage site assume `value`/`v` is a string (used directly as `form.question`, passed to `saveDraft`, passed to `prepareEditorHtmlForSave`). Without a fix on one side or the other, every edit would store `"[object Object]"` (or whatever an object coerces to) as saved content. **This blocks migration outright until either the editor-side type/behavior mismatch is fixed (recommended — it also blocks the npm audit) or Sootr's integration is rewritten to read `change.html` (or equivalent) from the new object shape.** |
| 3 | `table`/`media`/`formula` boolean toggles | `ClassicEditorProps` declares `table?: unknown; media?: unknown; formula?: unknown;` and **explicitly destructures and discards all three**, with a doc comment confirming this is deliberate ("silently ignored under canonical authority... this was already true before Phase 8b closeout"). There is no capability in the new editor's public API to disable the table tool or the media/formula toolbar items at all. | **Genuine gap, confirmed live and load-bearing**: PYEQ, MCQ, and Anomaly all pass `enableTable={false}` today, deliberately keeping tables out of question-style content. After migration, this would silently stop working — tables would become insertable in exactly the contexts the product explicitly disallows them today. This is a real product-behavior regression, not a cosmetic one, and there is currently no supported new-editor mechanism to restore it (would need new work on the editor side — e.g. reviving a real `disabledTools`/feature-toggle prop, distinct from the removed legacy plugin system — or accepting the behavior change as an intentional product decision). |
| 4 | `mediaManager: MediaManagerAdapter` (`upload(files: File[]): Promise<MediaItem[]>`, `search(query): Promise<MediaItem[]>`) | The new editor's actual media integration point is `mediaProvider?: MediaProvider` (`upload(file: File, opts): Promise<{url, id}>` — singular, different return shape; `search(query: string, filters?, page?)` — positional args, not one query object). `mediaManager?: boolean` is a **different, same-named prop** that only toggles which picker UI renders (library vs. simple), and does **not** accept an adapter object. Already anticipated in `docs/PHASE_11_5_MEDIAPROVIDER_FINDINGS.md` ("requires a thin adapter function translating `MediaProvider` calls into `MediaManagerAdapter`'s shape") — but that adapter does not exist in Sootr's code today, and the direction is backwards from what's needed (Sootr has a `MediaManagerAdapter`; the new editor wants a `MediaProvider`, so Sootr needs an adapter going the *other* way from what that finding described). | **Genuine gap, confirmed live and severe.** Passing Sootr's `MediaManagerAdapter` object into the new editor's `mediaManager: boolean` prop would just be truthy (harmlessly enabling the richer picker UI) — but since `mediaProvider` would be `undefined`, the new editor **disables the Insert Image/Video/Audio buttons entirely** (confirmed at the source: `CanonicalAuthorityEditor.tsx` gates all three on `!mediaProvider`, with no fallback path). **This is a hard, complete loss of media-upload capability in MCQ, Anomaly, and both study-material-block contexts** until Sootr writes a real `MediaManagerAdapter`→`MediaProvider` translation (the reverse of what `PHASE_11_5_MEDIAPROVIDER_FINDINGS.md` anticipated) wrapping `apiService.uploadImage`/`listImages` directly in the new shape. |
| 5 | PYEQ's "no media manager, use data-URL fallback" | The new editor has **no equivalent fallback** — without a `mediaProvider`, there is no way to insert media at all (see #4's "no fallback path" finding). | **Genuine gap**, a stricter version of #4: PYEQ would need an actual `MediaProvider` (even a minimal one that just wraps a file in a local blob/data URL, matching today's behavior) rather than being able to omit the prop as it does today. |
| 6 | `theme: "light" | "dark"` prop | Neither `ClassicEditorProps` nor `CanonicalAuthorityEditorProps` has a `theme` prop — `ClassicEditorAuthority.tsx` destructures and discards it (`theme: _theme`) exactly like `table`/`media`/`formula`. The new editor's actual dark-mode mechanism is a CSS class, `.srte-dark`, expected on/near the editor root (per `theme.ts`'s `--srte-*` custom-property redefinitions under `.srte-editor.srte-dark`) — a host applies the class itself; there's no prop-driven equivalent. | **Integration change, not a capability gap.** The mechanism exists (CSS class), just shaped differently than a prop. Sootr would need to apply `srte-dark` (or whatever wrapper class carries it) based on `resolvedTheme` itself, e.g. via a conditional class on `RichTextEditor`'s own wrapping `<div>` if the new editor reads the class from an ancestor, or directly if it needs to be on the editor's own root — needs a quick check against `ensureStyleSheet()`/`SRTE_DEFAULT_CSS`'s actual selector scoping once implementation starts. |
| 7 | `stripInlineStyles`'s hardcoded `var(--srte-*)` substitutions | Not yet confirmed whether the new editor's HTML export path can ever emit these same custom-property tokens into a saved `style=""` attribute (the live renderer only sets literal computed values, e.g. hex colors, inline for cells with *explicit* custom styling — the ambient default gridline color comes from a stylesheet rule, invisible to `innerHTML`). Likely a non-issue for the new editor specifically, but not verified against real content in this pass. | **Needs verification in §3's real-content test pass**, not assumed either way. |
| 8 | No custom toolbar/shortcut/validation logic | N/A — confirmed nothing else exists to map. | **No gap.** |

---

## 3. Proposed test plan (not executed in this pass)

### 3.1 Real content corpus

- Pull a representative sample of real Sootr documents per content type — MCQ question/explanation HTML, Anomaly question/explanation HTML, PYEQ question HTML, and study-material block `html_content` — via `apiService`'s existing list/get endpoints (e.g. `getBlocks`, whatever backs the MCQ/PYEQ list queries), similar in spirit to how `test-html-sootr.html` (`packages/react/e2e/fixtures/`, 15.8 kB, 113 lines, already in this repo) was captured from a real export.
- Run each through the new editor's actual **paste/import path** (not just re-typing it), matching how `test-html-sootr.html` is already exercised in `packages/react/e2e/canonical-authority.spec.ts` ("pastes a real Sootr export..."). Check for: content-loss, `[Unsupported: ...]` fallback markers, mark/style degradation (this exact class of bug is what caught the original span/div-wrapped-table loss, per `docs/bugs/html-import-span-and-div-wrapped-content-lost.md`).
- Specifically re-check item 2.7 above: does any real captured document's HTML, once round-tripped through the new editor and re-exported, contain a literal `var(--srte-*)` token that `stripInlineStyles` would need to keep handling, or is that substitution logic now dead code safe to remove?
- Table-bearing block content is the highest-value sample here, given this session's own recent table-border-options and table-resize work landed on the uncommitted branch — real Sootr tables are exactly the content most likely to exercise it under realistic conditions rather than synthetic test fixtures.

### 3.2 Real workflow walkthroughs

Concrete scenarios, not generic smoke tests, matching §1.3's actual usage patterns:

1. **Create a new MCQ**: question + explanation, apply bold/italic/a formula, insert an image via the real media manager flow (through `imageMediaManager`'s wired `apiService.uploadImage`), save, reload the MCQ, confirm content and image persisted correctly. Confirm no table-insert affordance appears (enforcing gap #3's product requirement, however it ends up being restored).
2. **Edit an existing study-material block**: load a real block (exercising the safe initial-load path from §1.4), insert/edit a table (this context wants tables), insert an image via the real media manager, save, confirm persisted. Then specifically test the **"Restore draft" banner** (gap #1) — make an edit, do *not* save, simulate a draft existing (or trigger the real autosave-to-local mechanism if accessible), reload the page, click "Restore," and confirm the editor's visible content actually updates (this is expected to fail without the `ref`+`replaceValue()` fix; the test's job is to prove whether it fails, not to assume it).
3. **Create/edit a PYEQ**: exercise the base64-fallback path specifically (gap #5) — insert an image with no real media manager wired, save, confirm the image survives the `prepareEditorHtmlForSave` upload-on-save conversion to a real URL.
4. **Toggle dark mode** while an editor is open mid-session (gap #6) — confirm the editor actually re-themes, not just the surrounding chrome.
5. **Lock/readonly**: the block-edit page's `readOnly={isEditorLocked}` — confirm the new editor's `readOnly` prop (present on both old and new APIs, unaffected by this migration) still fully locks editing, including blocking the media/table/formula toolbar affordances that a `readOnly` state should disable.

### 3.3 Integration surface test

- Write a **new, minimal adapter** (`MediaManagerAdapter` → `MediaProvider`, the direction needed per gap #4) as an isolated, directly-testable function — unit-test it against `createDefaultMediaManager()`'s real shape (mock `apiService.uploadImage`/`listImages` responses) before ever mounting a real editor, so a media-flow bug is caught at the adapter level, not buried inside an end-to-end click-through.
- Once `RichTextEditor.tsx` is adapted (ref-forwarding for gap #1, the onChange shape for gap #2, the media adapter for gaps #4/#5), test it in isolation against the new editor using Sootr's own component (not a simplified stand-in), so the integration surface itself — not just the underlying editor — is what's verified.
- Confirm `stripInlineStyles`/`prepareEditorHtmlForSave`'s save-time pipeline runs correctly against the new editor's actual export output for each real content sample from §3.1.

### 3.4 Local build vs. published package

**Recommend testing against a local/workspace build** (e.g. `pnpm link`, or a `file:` dependency pointing at `packages/react`'s built `dist/`, or Sootr's own package manager's workspace-linking equivalent) rather than waiting for the npm-publish fix cycle (`docs/PHASE_PRE_PUBLISH_AUDIT.md`) to complete. This phase's investigation surfaced real, load-bearing integration gaps (§2, items 1/2/4/5) that need Sootr-side code changes regardless of packaging correctness — that work can start immediately and does not depend on the package being publishable. The two efforts are independent, exactly as this prompt states.

---

## 4. Readiness assessment and recommendation

### Per-item disposition (§1/§2 items)

| Item | Disposition |
|---|---|
| Controlled `value` / content re-sync (#1) | **Ready with a specified integration change** — forward a `ref` through `RichTextEditor.tsx`, use `SmartEditorHandle.replaceValue()` for the one confirmed post-mount-update call site (draft restore). |
| `onChange` string signature (#2) | **Blocking as of today** — needs either the editor-side type/behavior fix (already flagged independently in the npm audit, and the better fix since it also serves every other consumer) or a Sootr-side unwrap of the new object shape. Either resolves it; recommend the editor-side fix since it's already required for npm-publish readiness anyway and avoids Sootr carrying compatibility code for an admittedly-broken type contract. |
| `table`/`media`/`formula` toggles (#3) | **Genuine gap needing editor-side work** — no current mechanism to disable individual toolbar capabilities. Needs a product decision: build a real toggle mechanism, or accept tables becoming available in MCQ/Anomaly/PYEQ as an intentional scope change communicated to Sootr's product owner before rollout (not a decision this document makes). |
| Media manager wiring (#4/#5) | **Ready with a specified integration change** — write the `MediaManagerAdapter`→`MediaProvider` adapter (§3.3), wire it into `RichTextEditor.tsx` in place of the current direct pass-through. Concrete, bounded, no editor-side changes needed. |
| Theme prop (#6) | **Ready with a specified integration change** — apply the `srte-dark` class conditionally instead of passing a `theme` prop. |
| `var(--srte-*)` style leakage (#7) | **Needs verification**, not yet a known gap either way. |
| Everything else (custom toolbar/shortcuts/validation) | **No gap — nothing to adapt.** |

### Overall

**Broadly positive, with one real blocker and one real product decision needed before any rollout:**

- **Blocker**: gap #2 (`onChange` shape) must be resolved — either editor-side (recommended) or Sootr-side — before any content edited in the new editor can be saved correctly. This is not optional and not deferrable to "fix during rollout."
- **Product decision needed**: gap #3 (table/media/formula toggles) has no current technical fix without new editor-side work. Sootr's product owner needs to either accept the behavior change (tables become available everywhere) or this becomes a second blocker requiring editor-side scope.
- Everything else (#1, #4, #5, #6) is real, confirmed, bounded integration work with a clear fix already identified — not open-ended investigation.

### Recommended rollout approach

1. Fix gap #2 on the editor side (serves the npm-publish audit too — do this once, not twice).
2. Get a product decision on gap #3 before writing any adaptation code, since it changes the shape of the fix (a real toggle mechanism vs. "no fix needed, decision made").
3. Build the `RichTextEditor.tsx` adaptation (ref-forwarding, the media adapter, the theme class) against a local/workspace build of the new package, per §3.4.
4. Run §3.1's real-content corpus and §3.2's workflow walkthroughs against that local build.
5. **Roll out to PYEQ first**, not last — it is explicitly named in this project's own history as a lower-stakes context, has the simplest media story (once gap #5's minimal adapter exists), and has no table capability to lose either way (already disabled, and no product expectation that it should ever have tables). Behind a feature flag if Sootr's app already has an established flagging mechanism (not confirmed one way or the other in this pass — check `app/context/` or similar for an existing feature-flag pattern before assuming one needs to be built).
6. Promote to MCQ and Anomaly next (same shape as each other), then the study-material block editor last (the only context exercising tables, and the only one with the confirmed draft-restore/controlled-value dependency actually observed in real code) — once its ref-forwarding fix has been specifically exercised against the real "Restore draft" flow, not just unit-tested in isolation.

Do not attempt a single big-bang switch across all five call sites at once — the three usage patterns identified in §1.3 have different risk profiles (PYEQ: low, no tables, simplest media path; MCQ/Anomaly: medium, real media manager but no tables; study blocks: highest, tables + the confirmed draft-restore gap), and rolling out lowest-to-highest risk matches how this project has approached every other high-change-volume rollout in its own history (proposal → owner confirmation → scoped implementation → real-content verification, per the toolbar redesign and formula-library precedents this document was asked to match).
