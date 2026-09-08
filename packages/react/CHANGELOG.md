# Changelog

## 1.0.0-beta.12

- Fix toolbar dropdowns/popovers inside a `contain: paint | strict | content` ancestor rendering off-screen or clipped to invisible near that ancestor's own edge — `1.0.0-beta.11`'s `contain` fix corrected the coordinate origin but still clamped against the full viewport instead of the actual clipping box, so a menu near the host's own right/bottom edge could compute a position outside what the ancestor actually lets paint, making it invisible even though its coordinates looked reasonable. Affects `ToolbarDropdown`, `MobileMoreMenu`, the color picker popover, and the table border popover — all four shared the same viewport-only clamping logic. See `docs/bugs/toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md`.
- The Bulleted list/Numbered list toolbar buttons now act as a toggle that reapplies the last preset you picked for that list kind (via "More list tools") instead of always resetting to the plain default marker. Picking "Diamond bullets" once, turning the list off, then clicking Bulleted list again reapplies diamond bullets directly. Session-only (not persisted), and does not apply to the checklist toggle.
- Add a small preset picker directly to the Bulleted list/Numbered list toolbar buttons (a split control — the button itself keeps its existing one-click toggle behavior unchanged) so a specific named style can be applied straight from the button, without a trip to "More list tools." Works even when nothing is a list yet (creates one directly with that preset). Hidden only in a narrow sliver of container widths (below ~359px) too tight to fit it — visible at every more realistic width, including inside typical dialogs and split panes; the same presets stay reachable via the existing mobile "List preset" control regardless.
- Below 480px, the block type ("Paragraph"/"Heading"/...), Bulleted list, Numbered list, and Checklist controls drop their text label and show icon-only, keeping their name/tooltip on hover — frees up meaningful width in genuinely narrow embeddings without losing discoverability.

## 1.0.0-beta.11

- Fix toolbar dropdowns/popovers still landing far from their trigger inside a host container that uses CSS `contain: paint | strict | content` on an ancestor (a real gap in `1.0.0-beta.9`'s transform-only fix — `contain` also creates a `position: fixed` containing block, independent of `transform`). See `docs/bugs/toolbar-overlay-misplaced-inside-contain-ancestor.md`.

## 1.0.0-beta.10

- Fix a table row resize regression: dragging a row boundary back to where it started (after an earlier drag hit a row's natural content floor) inflated the neighboring row instead of restoring the original layout — the only way back was Undo. Reversing a boundary drag now correctly shrinks the table's total height instead of growing a neighbor that never actually had slack to give.

- Fix a horizontal line/page break appearing to be "not selectable": clicking one already set real node selection, but right-clicking showed no UI at all, unlike every other atom (image/video/audio/formula). Right-click now shows the same Delete-only action menu formula already gets (never Edit — neither atom has an editable field, and neither ever gets resize handles).
- Add a "Line spacing" toolbar dropdown (Paragraph group) with presets (1, 1.15, 1.5, 2, 2.5), a "Default" entry that clears the override, and a custom numeric value entry, matching Google Docs' own line-spacing picker shape. Shows a checkmark on the current value, or no checkmark at all when the selection spans blocks with differing values. New `tools.lineHeight` visibility flag (default visible). Depends on `smartrte-core@1.0.0-beta.5`.
- Add "Horizontal line" and "Page break" toolbar tools (in the "More to insert" group, plus wide-viewport-promoted standalone copies), and matching `tools.horizontalLine`/`tools.pageBreak` visibility flags. A page break renders as a dashed, labeled marker in the live editor — distinct from a horizontal line — and produces real pagination in both the exported HTML and this package's "Save as PDF" (a real browser print of that same HTML). Depends on `smartrte-core@1.0.0-beta.5`.
- Fix formulas rendering invisible in "Save as PDF" output (see `smartrte-core@1.0.0-beta.5`'s own changelog entry for the root cause).
- Rename the "Save as PDF" toolbar entry to "Print / Save as PDF" — it opens the browser's print dialog rather than triggering a direct file download like its "Save as ..." siblings; the new label sets the correct expectation instead of implying a one-click download.

## 1.0.0-beta.9

- Fix toolbar dropdowns, the mobile "More tools" kebab menu, and the text/background colour and table-border popovers rendering far from their own trigger when the editor is embedded inside a host container that has its own CSS `transform` on an ancestor - e.g. a Radix/shadcn `Dialog`'s own centering transform. These overlays now correctly account for the resulting change of containing block instead of assuming it's always the viewport.

## 1.0.0-beta.8

- Add a `tools` prop (`ClassicEditor`, `CanonicalAuthorityEditor`, and the standalone embed) letting a host hide any individual toolbar tool — Bold, Video, Version history, Review, and around 40 others — without wrapping or restyling the component. Every tool is visible by default; composes with existing gates (a required provider or capability must still be present). See the README's "Hiding individual toolbar tools" section for the full list and usage.
- Retire the never-shipped `showVersionHistory`/`showReview` props in favor of `tools.versionHistory`/`tools.comments`/`tools.suggestions`.
- Also export `EditorCapabilityPreset` from the package's public entry point (previously only reachable indirectly through `CanonicalAuthorityEditorProps`).

## 1.0.0-beta.7

- Fix the mobile "More tools" overflow menu getting clipped almost entirely off-screen when the editor is embedded inside a host container with `overflow: hidden` — the same fix already applied to the desktop toolbar dropdowns, now also covering this menu (the only overflow affordance on narrow viewports).
- Add the "List preset" control (decimal/lower-alpha/upper-alpha/roman-numeral/outline numbering styles, plus bullet-glyph presets) to the mobile "More tools" menu — previously only reachable from the desktop toolbar's "More list tools" dropdown, leaving narrow-viewport users with no way to use anything beyond plain bulleted/numbered/checklist lists.

## 1.0.0-beta.6

- Replace the media Edit overlay's plain alt-text prompt with a full "Media details" panel: link (with open-in-new-tab), corner radius, alignment, and license fields (description, source URL, type, version, attribution), matching the pre-canonical editor's own edit-panel field set. A library-picked image's existing license metadata is now carried onto the inserted atom instead of being discarded. Depends on `smartrte-core@1.0.0-beta.3`.

## 1.0.0-beta.5

- Add an opt-in `renderFormulaHtml` prop (on `ClassicEditor`/`CanonicalAuthorityEditor`) that bakes real KaTeX-rendered HTML into the formula elements of `onChange`'s exported HTML, instead of an empty placeholder — for hosts that display saved content directly (e.g. a read-only preview panel) without also running KaTeX against it. Depends on `smartrte-core@1.0.0-beta.2`.

## 1.0.0-beta.4

- Fix blockquote, table header, and dialog (media library, comments, suggestions, version history) backgrounds/text staying in their light-mode colors even when the host page is in dark mode — these now follow the host's own dark-mode CSS variables directly, the same way the rest of the editor's colors already did, instead of depending solely on the `.srte-dark` class reaching the editor correctly.

## 1.0.0-beta.3

- Fix toolbar dropdown menus (e.g. "More text styles", "More paragraph tools") getting visually clipped to unusable fragments when the editor is embedded inside a host container with `overflow: hidden` (e.g. a rounded card or a clipped split-pane panel) — the menu now positions itself relative to the viewport instead of the nearest ancestor, so it can never be clipped regardless of host layout.

## 1.0.0-beta.2

- Fix the toolbar promoting extra buttons based on the browser window's width instead of the editor's own rendered width — broke embedding the editor in a split pane or any container narrower than the window, causing overlapping/mashed toolbar labels and misdirected clicks that looked like an unresponsive toolbar.

## 1.0.0-beta.1

**BREAKING CHANGE.** `ClassicEditor` is now unconditionally the canonical, schema-driven editor (`CanonicalAuthorityEditor` underneath). The DOM-authoritative legacy editor and its rollback path have been fully removed; every published version through 0.3.4 defaulted to the DOM-authoritative implementation, so this changes real runtime behavior for every existing consumer, not just internals.

- Promote the canonical editing engine to sole production authority. Removed `LegacyClassicEditor` (the previous default), the runtime rollback flag, and all four of its DOM-authoritative command bridges.
- Add a documented, tested headless facade: `CanonicalEditorRuntime` / `SmartEditorHandle` (`createCanonicalEditorRuntime`) has zero React dependency and can drive a full editing session — mount, edit, checkpoint/restore, get/replace value — against a plain DOM element with no React runtime involved.
- Wire DOCX, PDF, and Markdown import/export to `smartrte-core`'s new format codecs, replacing the previous ad hoc, partially DOM-dependent adapters.
- Add live KaTeX rendering for formula content, including accessible MathML output.
- Depends on `smartrte-core@1.0.0-beta.1`.

## 0.3.5

- Remove the always-on drag handle that appeared next to every line, list item, and table.
- Keep list-style and blockquote changes scoped to the selection instead of bleeding into unrelated parts of the document.
- Fix blockquote and code block corrupting each other, or losing content, when toggled in sequence without reselecting text in between.
- Preserve code blocks and blockquotes nested inside each other, including on list items, instead of one silently stripping the other.
- Fix the toolbar's active-state indicators (and the code block toggle itself) going stale on list items after removing an enclosing blockquote.
- Stop pasted or existing blockquotes/code blocks from losing their border and internal spacing when the source HTML carries conflicting inline styles.

## 0.3.4

- Make foreground and background colours deterministic across paragraphs, lists, and table-cell text selections.
- Preserve foreground colour when highlighting text and render authored colours correctly in dark mode.
- Show the effective foreground and background colours at the caret in the toolbar and picker.
- Keep the table-cell fill picker and context menu open during live colour dragging, including multi-cell selections.

## 0.3.3

- Keep the responsive More-actions menu inside narrow viewports and above the editor canvas.
- Make long mobile action menus independently scrollable with touch-friendly overscroll behavior.

## 0.3.2

- Preserve paragraph and heading blocks when creating, restyling, or removing lists.
- Keep list conversion inside table cells, including legacy cells containing direct text and line breaks.
- Prevent list elements from being inserted beneath table rows or replacing table cells.
- Make nested-list Tab and Shift+Tab deterministic, depth-aware, selection-preserving, and independently styled.
- Remove the redundant standalone unlink control; links remain removable from the edit-link popover.
- Use a recognizable chain-link icon and consolidate document import/export formats into labeled menus.
- Redesign the editor chrome for Sootr with semantic toolbar groups, consistent outlined icons, Align/Move/Insert menus, responsive overflow, dark-theme tokens, and keyboard-accessible popovers.
- Keep formulas at the saved caret after dialog interaction, align checklist controls with their content, and render visible split-button chevrons.
- Restore list selections before Move-menu indentation, synchronize controls for newly created checklist items, render explicit checked borders/ticks, and keep Media discoverable without a custom adapter.

## 0.3.1

- Make caret-based superscript and subscript toggling deterministic in controlled React applications.
- Preserve normal text before and after script spans and prevent nested superscript/subscript markup.

## 0.3.0

- Rebuild list selection and conversion behavior for checklists, bullets, numbers, alphabetic lists, and Roman numerals.
- Support list-aware blockquotes and code blocks.
- Make heading and font-size changes deterministic across carets and multi-block selections.
- Add left, center, right, and justified block alignment, including list items, code blocks, and table cells.
- Redesign link insertion and editing with accessible fields, validation, display-text editing, removal, opening, and secure new-tab links.
- Add regression coverage for formatting, lists, links, table cells, and document serialization.
