# Smart RTE — Current Codebase Overview

> Snapshot generated on 2026-08-01 from commit `dc069f2` (`master`). Before this
> document was added, the working tree was clean and the local branch was two
> commits ahead of `origin/master`.

This document is a code-oriented handoff for an engineer or AI assistant that
needs to understand the repository as it exists today. The documents under
`docs/` describe the target architecture; this file also calls out where the
implementation is still hybrid or transitional.

> **For what comes next**, see `docs/PHASE_ROADMAP_8B_12B.md` (revised
> 2026-08-06) and `docs/PHASE_1_8B_INDEPENDENT_AUDIT.md`. This snapshot
> predates both and does not describe forward-looking phase work — read the
> roadmap for that, not this file.

## 1. What this repository contains

Smart RTE is a rich-text editor monorepo whose public compatibility contract is
primarily HTML in and HTML out.

There are three deliverables:

| Area | Package/version | Purpose |
| --- | --- | --- |
| `packages/core` | `smartrte-core@0.2.1` | Framework-independent document model, schema, selections, commands, transactions, history, plugins, and HTML/Markdown compatibility. |
| `packages/react` | `smartrte-react@0.3.4` | React `ClassicEditor`, DOM-to-core bridges, plugin/format runtimes, DOCX/PDF support, UI, and standalone browser bundle. |
| `dart/smartrte_flutter` | `smartrte_flutter@0.2.0` | Flutter WebView wrapper around a checked-in standalone React editor bundle. |

The root package is private (`smart-rte-monorepo@0.2.0`) and uses pnpm 9.10.0.
React 18+ is a peer dependency of the React package. TypeScript targets ES2020
and emits ES modules plus declarations.

## 2. Architecture at a glance

```text
Consumer application
        |
        | HTML value / onChange, props, files, user actions
        v
packages/react: ClassicEditor
  - toolbar, dialogs, menus, contentEditable DOM, theme
  - plugin runtime and format runtime
  - DOM selection/document/command bridges
        |
        | SmartDocument + SmartSelection + command input
        v
packages/core: SmartEditor
  - ordered plugins and schema
  - command -> SmartTransaction
  - normalization and validation
  - history and selection mapping
        |
        v
canonical HTML serializer -> React onChange

Standalone IIFE bundle (`window.SmartRTE`)
        |
        v
Flutter WebView + JavaScript channel (`ToFlutter` / `SmartBridge`)
```

The intended editing pipeline is:

```text
HTML / Markdown / paste / user action
  -> parser and normalizers
  -> SmartDocument + SmartSelection
  -> command
  -> SmartTransaction
  -> history
  -> editing DOM
  -> canonical HTML
```

HTML is the canonical interchange format. Markdown uses a separate
CommonMark/GFM path. DOCX aims to preserve portable semantics and styling where
possible. PDF is intentionally layout-oriented and heuristic rather than a
semantic round-trip format.

### Current implementation reality

The core migration is active but not complete. `DomEditorController` is the
canonical boundary for model-backed snapshots, serialization, command dispatch,
replacement, and history integration. React still owns rendering and several
legacy DOM-only behaviors. `ClassicEditor.tsx` is currently a large monolithic
component (about 7,951 lines) containing much of the toolbar and editor UI,
event handling, dialogs, table/image overlays, and compatibility behavior.

Do not assume every visible toolbar action is purely model-driven. When changing
an editing behavior, inspect both its core command/plugin and its React DOM
bridge/call site.

The Phase 1/C0 contracts, Phase 2 semantic selection framework, and Phase 2.5
canonical editing surface now live in the public `smartrte-core/foundation`
subpath. They intentionally coexist with the legacy package-root contracts so
contract work does not leak into feature migration. New kernel work must use
the foundation subpath.

## 3. Repository structure

```text
smart-rte/
├── package.json                 # Root scripts and pnpm declaration
├── pnpm-workspace.yaml          # Workspace globs
├── pnpm-lock.yaml               # Primary workspace lockfile
├── package-lock.json            # Also checked in; not the primary pnpm lock
├── README.md                    # Product overview and React usage
├── design.md                    # Design notes
├── docs/
│   ├── ARCHITECTURE.md          # Target core migration and invariants
│   ├── PLUGIN_ARCHITECTURE.md   # Plugin/runtime contract
│   ├── FORMAT_FIDELITY.md       # Format fidelity policy
│   ├── TESTING.md               # Required checks and regression rules
│   └── dev-internal-flags.md    # Shadow/core migration flags
├── scripts/
│   ├── check-foundation-boundary.mjs # Prevents new legacy contract imports
│   ├── check-scope-contract.mjs      # Enforces ID-only/read-only scope APIs
│   ├── check-phase2-5-contract.mjs   # Apply/index/surface scope gates
│   ├── benchmark-phase2.mjs          # Scope scaling at 500/2k/10k units
│   └── benchmark-phase2-5.mjs        # Apply/cache scaling at 500/2k/10k
├── packages/
│   ├── core/                    # Headless TypeScript editing engine
│   │   ├── src/
│   │   │   ├── index.ts         # Public exports
│   │   │   ├── model.ts         # SmartDocument AST and node types
│   │   │   ├── editor.ts        # SmartEditor orchestration
│   │   │   ├── command.ts       # Command contracts
│   │   │   ├── transaction.ts   # Operations and transaction application
│   │   │   ├── history.ts       # Undo/redo and inverse transactions
│   │   │   ├── selection.ts     # Text/node/cell/all selections
│   │   │   ├── selectionMapping.ts
│   │   │   ├── schema.ts        # Validation and normalization
│   │   │   ├── plugin.ts        # Plugin contract and dependency ordering
│   │   │   ├── preset.ts        # Standard feature/plugin preset
│   │   │   ├── marks.ts         # Inline mark helpers
│   │   │   ├── table.ts         # Table model helpers
│   │   │   ├── tree.ts          # Tree/path helpers
│   │   │   ├── listScope.ts     # Resolves affected list scope
│   │   │   ├── listPresets.ts   # Marker/preset families by nesting depth
│   │   │   ├── commands/        # Model mutations by capability
│   │   │   ├── plugins/         # Command/schema bundles per feature
│   │   │   ├── html/            # HTML parser/serializer compatibility
│   │   │   ├── markdown/        # CommonMark/GFM compatibility
│   │   │   ├── security/        # URL sanitization policy
│   │   │   └── foundation/      # Frozen Phase 1/C0 canonical kernel
│   │   │       ├── types.ts     # Schema/model/position/op/transaction contracts
│   │   │       ├── schema.ts    # Foundation schema validation and repair
│   │   │       ├── positions.ts # Resolved positions and grapheme boundaries
│   │   │       ├── operations.ts
│   │   │       ├── transactions.ts
│   │   │       ├── normalization.ts
│   │   │       ├── history.ts
│   │   │       ├── modelDom.ts
│   │   │       ├── scope/       # Phase 2 selection + incremental index/lookup
│   │   │           ├── types.ts
│   │   │           ├── resolveScope.ts
│   │   │           └── scope.test.ts
│   │   │       └── surface/     # Phase 2.5 renderer and browser input pipeline
│   │   │           ├── types.ts
│   │   │           ├── renderer.ts
│   │   │           └── input.ts
│   │   └── test/fixtures/       # HTML and Markdown regression fixtures
│   └── react/                   # React package and browser integration
│       ├── src/
│       │   ├── index.ts         # Public exports
│       │   ├── components/
│       │   │   ├── ClassicEditor.tsx
│       │   │   ├── LinkEditorPopover.tsx
│       │   │   └── MediaManager.tsx
│       │   ├── adapters/        # DOM/core and file-format boundaries
│       │   ├── editorController.ts
│       │   ├── pluginRuntime.ts
│       │   ├── formatRuntime.ts
│       │   ├── builtInFormatDefinitions.ts
│       │   ├── formatFidelity.ts
│       │   ├── theme.ts
│       │   └── standalone/classic-editor-embed.tsx
│       ├── e2e/                 # Playwright user workflows
│       ├── playground/          # Vite app; ?canonical=1 opens Phase 2.5 surface
│       ├── vite.config.ts       # Standalone IIFE build
│       ├── vitest.config.ts
│       └── playwright.config.ts
├── dart/
│   ├── smartrte_flutter/
│   │   ├── lib/classic_editor.dart
│   │   └── assets/editor/       # index.html, bundled editor.js, WASM asset
│   └── example_app/             # Minimal local Flutter consumer
├── table-resize-code.tsx        # Standalone/experimental table resize code
├── table-resize-implementation.md
└── TABLE-RESIZE-README.md
```

The workspace file also contains globs for `rust/*` and `apps/*`, but those
directories are not present in this snapshot.

## 4. Core package

### Canonical document model

`SmartDocument` is a block tree. Its principal blocks are paragraphs, headings,
lists/list items, blockquotes, code blocks, images, other media, and tables.
Inline content is text, formula atoms, or inline-image atoms. Text can carry
bold, italic, underline, strike, script, code, color, font, formula, and link
marks.

Important invariants:

- A document contains block nodes.
- Table cells contain block nodes, never raw text or editor wrappers.
- Renderer-only wrappers and `data-srte-*` UI elements must not serialize.
- Commands operate on the resolved selection.
- Model changes are represented as transactions.
- User-visible model mutations should have inverse history operations.

### SmartEditor lifecycle

`createSmartEditor()` constructs `SmartEditor` with an initial state and plugin
set. Construction orders dependencies, builds the schema, normalizes and
validates the document, and registers command IDs. Execution follows this path:

```text
canExecute(commandId, input)
  -> command.execute(state, input)
  -> transaction
  -> apply transaction
  -> schema + plugin normalizers (max 10 fixed-point passes)
  -> validation
  -> history update
  -> plugin hooks and subscribers
```

`SmartEditor` also supplies read-only enforcement and undo/redo.

### Standard core plugins

The default preset enables all of these unless filtered:

| Feature key | Plugin ID | Responsibility |
| --- | --- | --- |
| `basicFormatting` | `basic-formatting` | Inline marks and links/colors/font formatting. |
| `blockType` | `block-type` | Paragraph/heading block conversion. |
| `alignment` | `alignment` | Block alignment. |
| `list` | `list` | Ordered/unordered lists, nesting, styles, and presets. |
| `checklist` | `checklist` | Task list behavior; depends on `list`. |
| `blockquote` | `blockquote` | Quote blocks. |
| `codeBlock` | `code-block` | Code block conversion. |
| `table` | `table` | Insert/edit/merge/split/remove table structures. |
| `media` | `media` | Images and media nodes. |
| `formula` | `formula` | Formula atoms. |
| `move` | `move` | Moving blocks/items. |

Plugin dependency errors, duplicate plugin IDs, cycles, and duplicate command
IDs fail fast. Custom plugins can contribute schema, commands, normalizers, and
transaction hooks.

### Compatibility and security

- `html/compatibility.ts` parses/sanitizes HTML into the model and serializes
  canonical HTML. Regression fixtures include Word, Google Docs, tables,
  nested lists, marks, formulas, and media.
- `markdown/compatibility.ts` uses unified/remark with GFM support. Markdown
  indentation is semantic; HTML nesting is not guessed from indentation.
- `security/urlPolicy.ts` centralizes accepted/sanitized URL behavior.

## 5. React package

### Public surface

The main public component is:

```tsx
<ClassicEditor value={html} onChange={setHtml} />
```

Key props include controlled HTML, placeholder and size bounds, read-only mode,
theme, font options, paste/import style preservation, legacy
`table`/`media`/`formula` toggles, `features`, an exact custom `plugins` list,
`formats`, custom `formatDefinitions`, and a `mediaManager` adapter.

The package also exports:

- React plugin runtime types and `createReactEditorPluginRuntime`.
- DOM editor controller APIs.
- HTML/Markdown document format registry APIs.
- DOCX import/export helpers and styled-DOCX enhancement.
- PDF import/reconstruction/print helpers.
- Format runtime and executable fidelity matrix.
- Theme CSS and injection helper.

### Runtime ownership

`createReactEditorPluginRuntime()` resolves one authoritative plugin set for
both visible UI contributions and core command availability.

- `features` filters the built-in preset.
- `plugins` replaces the preset with an exact runtime.
- Plugin UI contributions can add toolbar controls, shortcuts, context-menu
  items, and formats.
- Contributions are ordered deterministically and validated against registered
  commands; duplicate contribution IDs and missing commands throw.

`createEditorFormatRuntime()` independently filters or replaces document
formats. Built-ins are HTML, Markdown, DOCX, and PDF. Plugins can contribute
additional formats.

### DOM/core bridge

The most important adapter files are:

| File | Role |
| --- | --- |
| `domSmartDocument.ts` | Converts editor DOM/HTML to `SmartDocument`, removes editor-only nodes, and serializes model HTML. |
| `domSelectionBridge.ts` | Maps browser `Selection`/`Range` to model paths and restores model selections to DOM. |
| `domCommandBridge.ts` | Generic model command execution against a DOM root. |
| `domBlockCommandBridge.ts` | Block conversions. |
| `domChecklistCommandBridge.ts` | Checklist item state. |
| `domInlineAtomCommandBridge.ts` | Formula insertion and atomic inline deletion. |
| `domInlineImageCommandBridge.ts` | Inline-image insertion/update. |
| `domMoveCommandBridge.ts` | Directional move commands. |
| `domTableCommandBridge.ts` | Table operations and removal. |
| `inlineMarkCoreExecution.ts` | Feature-flagged core execution for selected inline marks. |
| `shadowMode.ts` | Compares legacy and core output without changing persisted HTML. |
| `internalFlags.ts` | Reads internal migration flags. |

`DomEditorController` binds a contenteditable root, derives canonical snapshots,
executes commands through temporary `SmartEditor` instances, replaces DOM from
serialized model output, emits change snapshots, and coordinates HTML plus
canonical transaction history.

### Formats

- HTML: canonical and highest-fidelity format.
- Markdown: CommonMark/GFM import/export through core compatibility code.
- DOCX: ZIP/XML export, Mammoth-backed import, styling/table enhancements, and
  portable markers for formula/image atoms.
- PDF: PDF.js-based heuristic text/page reconstruction on import and browser
  print-document generation on export.

The executable fidelity contract is `src/formatFidelity.ts`; update it together
with adapter behavior and round-trip tests.

### Standalone and Flutter path

Vite builds `src/standalone/classic-editor-embed.tsx` as an IIFE named
`SmartRTE`, producing `dist/standalone/editor.js`. The embed exposes
`window.SmartRTE.ClassicEditor.init(...)` and a controller with `setHtml`,
`getHtml`, `focus`, `blur`, and `destroy`.

Flutter loads `assets/editor/index.html` in `webview_flutter`. Communication is:

```text
Flutter -> JavaScript: window.SmartBridge.handle({ type, ... })
JavaScript -> Flutter:  window.ToFlutter.postMessage(JSON string)
```

Supported messages include ready, change, set HTML, get HTML, focus, and blur.
The standalone bundle is checked into the Flutter package, so React changes do
not reach Flutter until the bundle/assets are rebuilt and copied.

## 6. Testing and development commands

From the repository root:

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm check
```

Package-level release checks documented by the project are:

```bash
pnpm --filter smartrte-core test
pnpm --filter smartrte-core build
pnpm --filter smartrte-core lint
pnpm --filter smartrte-react test
pnpm --filter smartrte-react build
pnpm --filter smartrte-react lint
```

Run React browser workflows with:

```bash
pnpm --filter smartrte-react e2e
```

The Playwright config starts the React playground at `127.0.0.1:5173` and runs
Chromium, Firefox, and WebKit. Current E2E suites cover formatting, lists,
tables, format runtime, remaining editor workflows, and the standalone
canonical editing surface.

Current source test footprint:

- Core: 87 source files, including 27 unit-test files.
- React: 61 source files, including 31 unit-test files.
- React E2E: 6 Playwright spec files.
- Core fixtures: HTML compatibility corpus plus a Markdown fixture corpus.

Package `lint` currently means TypeScript checking with `--noEmit`, not ESLint.
Core TypeScript is strict; React currently has `strict: false`.

## 7. Recent state and active direction

The two local commits not yet on `origin/master` are:

1. `148cb8e` — introduced `DomEditorController`, the expanded core command and
   plugin system, format runtimes/adapters, DOCX/PDF work, and broad unit/E2E
   coverage.
2. `dc069f2` — enhanced list scope, presets, styling, serialization, DOM bridge
   behavior, and list tests.

The latest list work adds marker families such as bullet variants, decimal,
parenthesized decimal, outline, alpha, Roman, and leading-zero styles, with
depth-aware fallback styles.

## 8. High-risk areas and practical guidance

- Treat `ClassicEditor.tsx` as a hotspot. Changes can affect unrelated toolbar,
  selection, overlay, paste, table, or history behavior; add focused tests.
- Maintain semantic HTML compatibility. Exact byte equality is not always
  required, but valid block structure, marks, tables, and editor-wrapper removal
  are required.
- Browser DOM selection is an adapter input, not the desired source of truth.
  Never serialize overlays, resize handles, menus, placeholders, or other
  `data-srte-*` UI.
- Table cells must continue to contain blocks. Table merge/split and undo/redo
  are high-risk regression areas.
- Lists span model structure, preset resolution, HTML/Markdown serialization,
  DOM bridging, toolbar state, and browser keyboard behavior. Test all relevant
  layers when modifying them.
- Keep editing plugins separate from import/export adapters. A format is not an
  editing capability.
- Validate URLs through the shared URL policy rather than adding ad hoc link or
  media checks.
- External HTML emitted by the editor is raw HTML; consuming applications are
  still responsible for sanitizing untrusted content at their display boundary.
- The Flutter asset bundle is generated output but checked in. Confirm whether a
  change requires rebuilding it; do not edit the minified bundle by hand.
- `pnpm-workspace.yaml` contains currently unused `rust/*` and `apps/*` globs.
  Both pnpm and npm lockfiles exist; use pnpm for the documented monorepo flow.

## 9. Suggested reading order for a new contributor or Claude

1. This document.
2. `docs/ARCHITECTURE.md` and `docs/PLUGIN_ARCHITECTURE.md`.
3. `packages/core/src/model.ts`, `transaction.ts`, `schema.ts`, and `editor.ts`.
4. `packages/core/src/preset.ts`, then the command/plugin relevant to the task.
5. `packages/react/src/editorController.ts` and the matching files under
   `packages/react/src/adapters/`.
6. `packages/react/src/components/ClassicEditor.tsx`, reading only the relevant
   feature sections and call sites.
7. Nearby unit tests, E2E workflow, and compatibility fixture before editing.

For format work, additionally read `docs/FORMAT_FIDELITY.md`,
`formatRuntime.ts`, `builtInFormatDefinitions.ts`, and the target adapter. For
Flutter work, trace the standalone embed before the Dart WebView wrapper.
