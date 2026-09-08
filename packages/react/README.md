# smartrte-react

[![npm version](https://img.shields.io/npm/v/smartrte-react.svg)](https://www.npmjs.com/package/smartrte-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A rich text editor for React, built on a document-model core rather than raw `contentEditable` state — tables, LaTeX/KaTeX formulas, media, DOCX/PDF/Markdown import-export, per-tool toolbar visibility, and host-owned integration points for version history, comments, and suggestions/track-changes.

It pairs with [`smartrte-core`](https://www.npmjs.com/package/smartrte-core), a framework-agnostic document engine — you only need this package to use it from React.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Which component do I use?](#which-component-do-i-use-canonicalauthorityeditor-vs-classiceditor)
- [Props](#props)
- [Toolbar customization](#toolbar-customization)
- [Capability presets](#capability-presets-table-onoff)
- [Host-owned providers](#host-owned-providers-media-versions-comments-suggestions)
- [Imperative handle](#imperative-handle-ref)
- [Import & export formats](#import--export-formats)
- [Theming](#theming)
- [Standalone / non-React embed](#standalone--non-react-embed)
- [Security](#security)
- [Browser support](#browser-support)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install smartrte-react
# or: pnpm add smartrte-react / yarn add smartrte-react
```

`react` and `react-dom` (`>=18`) are peer dependencies — install them if your project doesn't already have them. No separate CSS import is required; the editor injects its own stylesheet on mount.

## Quick start

```tsx
import { useState } from "react";
import { CanonicalAuthorityEditor } from "smartrte-react";

function App() {
  const [content, setContent] = useState("<p>Start typing…</p>");

  return (
    <CanonicalAuthorityEditor
      defaultValue={content}
      onHtmlChange={setContent}
      placeholder="Type here…"
    />
  );
}
```

`defaultValue` is uncontrolled — it seeds the editor once on mount, not on every render (see [Props](#props) for why, and how to programmatically replace content later via the imperative handle).

## Which component do I use? `CanonicalAuthorityEditor` vs `ClassicEditor`

- **`CanonicalAuthorityEditor`** — the actual editor. Everything in this guide (tools, providers, presets, the imperative handle) is its API. Use this for anything new.
- **`ClassicEditor`** — a thin backwards-compatibility wrapper around `CanonicalAuthorityEditor`, kept for integrations written against the package's older `value`/`onChange: (html: string) => void` shape. It forwards everything it can (`tools`, `mediaProvider`, `versionProvider`, etc.) but silently ignores a handful of props from an even older, now-retired plugin system (`features`, `plugins`, `formats`, `fonts`, `theme`, `mediaManager` as an adapter object). If you're starting fresh, use `CanonicalAuthorityEditor` directly — `ClassicEditor` exists so old call sites keep compiling, not as a recommended entry point.

```tsx
// Legacy-compatible shape - only use this if migrating an existing integration
import { ClassicEditor } from "smartrte-react";

<ClassicEditor value={htmlString} onChange={(html) => setHtmlString(html)} />
```

## Props

The commonly-used `CanonicalAuthorityEditor` props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `defaultValue` | `string \| PersistedEditorDocument` | `undefined` | Initial content (HTML string or a previously-saved document envelope). Uncontrolled after mount — see [Imperative handle](#imperative-handle-ref) to replace content later. |
| `onChange` | `(change: SmartEditorChange) => void` | `undefined` | Fires per transaction with the structured change event. |
| `onHtmlChange` | `(html: string) => void` | `undefined` | Debounced (~250ms after the last edit) plain-HTML serialization — the simplest way to persist content as a string. |
| `preset` | `"full" \| "simple"` | `"full"` | Construction-time capability preset — `"simple"` excludes the table plugin entirely (schema-level, not just hidden in the toolbar). See [Capability presets](#capability-presets-table-onoff). |
| `tools` | `Partial<ToolbarTools>` | every tool `true` | Hide individual toolbar tools without touching document capability. See [Toolbar customization](#toolbar-customization). |
| `mediaProvider` | `MediaProvider` | `undefined` | Host-owned upload/search/remove boundary for images, video, and audio. Absent ⇒ media tools don't render. |
| `mediaManager` | `boolean` | `true` when `mediaProvider` is set | Use the library/search/duplicate-detection picker for images (vs. the plain file-input default). |
| `mediaPicker` | `MediaPickerComponent` | built-in file picker | Replace the default file-picker UI for video/audio (and images, if `mediaManager` is `false`). |
| `versionProvider` | `VersionProvider` | `undefined` | Host-owned save/list/load/remove boundary for version history. Absent ⇒ Version History tool doesn't render. |
| `commentProvider` | `CommentProvider` | `undefined` | Host-owned boundary for comment threads. Absent ⇒ comment tools/markers don't render. |
| `suggestionProvider` | `SuggestionProvider` | `undefined` | Host-owned boundary for *structural* suggestions (track-changes). Absent ⇒ suggestion tools/markers don't render. |
| `authorId` | `string` | `"anonymous"` | Attributed to new comment replies and suggestions. |
| `renderFormulaHtml` | `boolean` | `false` | Bake real KaTeX-rendered HTML into `onHtmlChange`'s formula markup instead of an empty placeholder — turn this on if you render that HTML anywhere outside the editor (email, PDF export, a read-only view without KaTeX loaded). |
| `onClipboardDiagnostic` | `(report: ClipboardDiagnosticReport) => void` | `undefined` | Inspect what a paste was parsed as / why it was rejected — useful while debugging a host's own copy sources. |
| `placeholder` | `string` | `undefined` | Placeholder text shown when the editor is empty. |
| `minHeight` / `maxHeight` | `number \| string` | `undefined` | Editing-surface height bounds. |
| `readOnly` | `boolean` | `false` | Disables editing; toolbar tools become inert. |
| `className` | `string` | `undefined` | Extra class(es) on the editor's root element — this is also how you enable [dark mode](#theming). |
| `onRuntime` | `(runtime: CanonicalEditorRuntime) => void` | `undefined` | Escape hatch for tests/diagnostics; not part of the stable editing contract. |

`ClassicEditor` accepts the same props under `value`/`onChange: (html) => void` instead of `defaultValue`/`onHtmlChange`, plus a legacy `table?: boolean` (equivalent to `preset={table === false ? "simple" : "full"}`).

## Toolbar customization

`tools` hides individual toolbar entries — Bold, Video, Version history, whatever you name — without touching what the document itself can *store*. Every tool defaults to visible; only name the ones you want off:

```tsx
<CanonicalAuthorityEditor
  tools={{ video: false, audio: false, versionHistory: false, comments: false, suggestions: false }}
/>
```

`tools` can only ever hide something, never conjure it into existence — a tool still needs its underlying capability to actually be there:

- `image`/`video`/`audio` also need `mediaProvider` configured.
- `versionHistory` also needs `versionProvider`; `comments` needs `commentProvider`; `suggestions` needs `suggestionProvider`.
- `insertTable` also needs the table capability enabled (i.e. you haven't set `preset="simple"`).

This means it's always safe to leave `tools` unset — a consumer who never passes it sees every tool their other configuration already supports.

**Every toggleable key**, grouped the way they appear in the toolbar:

```ts
interface ToolbarTools {
  // Text formatting
  bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; code: boolean;
  superscript: boolean; subscript: boolean; textColor: boolean; backgroundColor: boolean;
  fontSize: boolean; fontFamily: boolean;

  // Paragraph
  blockType: boolean;   // the Paragraph/Heading 1-6/Code block dropdown
  alignLeft: boolean; alignCenter: boolean; alignRight: boolean; alignJustify: boolean;
  lineHeight: boolean;  // the line-spacing dropdown (1/1.15/1.5/2/2.5 presets plus a custom value)
  quote: boolean;

  // Lists
  bulletedList: boolean; numberedList: boolean; checklist: boolean;
  listPreset: boolean;   // the named marker-preset picker (decimal/alpha/roman/outline/bullet glyphs)

  // Insert
  link: boolean; removeLink: boolean;
  image: boolean; video: boolean; audio: boolean;   // each requires mediaProvider
  insertFormula: boolean; specialCharacters: boolean;
  horizontalLine: boolean;   // inserts a divider (<hr>)
  pageBreak: boolean;        // a print/export pagination marker, distinct from horizontalLine
  insertTable: boolean;      // requires the table capability (preset)

  // Document
  import: boolean;
  saveAsHtml: boolean; saveAsMarkdown: boolean; saveAsWord: boolean; saveAsPdf: boolean; saveAsSmartRte: boolean;
  versionHistory: boolean;   // requires versionProvider
  comments: boolean;         // requires commentProvider
  suggestions: boolean;      // requires suggestionProvider

  // History
  undo: boolean; redo: boolean;
}
```

Purely contextual actions that only ever act on something already selected — moving a block up/down, indenting a list item, adding/removing a table row, resizing a selected image — aren't individually toggleable; they follow their owning tool's visibility (turn off `insertTable` and its row/column actions go with it, with no separate flag to remember).

## Capability presets (table on/off)

`preset` is a construction-time, host/integrator-level setting (there's no in-editor UI for a user to change their own preset) — it decides which plugins the document's *schema* is built with, not just what the toolbar shows:

```tsx
<CanonicalAuthorityEditor preset="simple" />   // excludes the table plugin entirely
<CanonicalAuthorityEditor preset="full" />     // default - excludes nothing
```

`"simple"` exists for content that should never contain tables at all (e.g. a short-answer question editor) — `preset="simple"` and `tools={{ insertTable: false }}` are not equivalent: the latter only hides the button, the former means the schema itself will reject a pasted or imported table.

## Host-owned providers (media, versions, comments, suggestions)

Four features are opt-in via a provider interface the *host* implements — the package never holds storage credentials, a socket, or a database connection itself. Absent provider ⇒ that feature's toolbar entries simply don't render; nothing crashes or shows a broken control.

```ts
interface MediaProvider {
  upload(file: File, opts?: { signal?: AbortSignal }): Promise<{ url: string; id: string }>;
  search(query: string, filters?: MediaFilters, page?: number): Promise<MediaItem[]>;
  remove(id: string): Promise<void>;
}

interface VersionProvider {
  save(version: DocumentVersion): Promise<VersionListEntry>;
  list(): Promise<readonly VersionListEntry[]>;
  load(id: string): Promise<DocumentVersion>;
  remove(id: string): Promise<void>;
}

interface CommentProvider {
  list(): Promise<readonly CommentThread[]>;
  save(thread: CommentThread): Promise<void>;
  remove(threadId: string): Promise<void>;
}

interface SuggestionProvider {
  list(): Promise<readonly StructuralSuggestion[]>;
  save(suggestion: StructuralSuggestion): Promise<void>;
  remove(suggestionId: string): Promise<void>;
}
```

```tsx
<CanonicalAuthorityEditor
  mediaProvider={{
    async upload(file) {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body });
      return res.json(); // { url, id }
    },
    async search(query) {
      const res = await fetch(`/api/media?q=${encodeURIComponent(query)}`);
      return res.json();
    },
    async remove(id) {
      await fetch(`/api/media/${id}`, { method: "DELETE" });
    },
  }}
/>
```

Your `upload` implementation must independently validate file type, size, and content server-side — the editor applies only a best-effort client-side allow-list check as a UX nicety, not a security boundary.

There's a fifth contract, **`CollabTransport`** (real-time multi-writer editing), exported for hosts building against it — it defines `sendTransaction`/`onRemoteTransaction`/`onPresenceUpdate`/`sendPresence`/`getRevisionHistory`, but isn't wired into the editor's runtime yet. Without one connected, the editor behaves exactly as it does today: single-writer, no rebase path ever triggers.

## Imperative handle (ref)

`CanonicalAuthorityEditor`/`ClassicEditor` forward a `SmartEditorHandle` ref for everything `defaultValue`/props alone can't do — replacing content programmatically, reading the current document, and version snapshots:

```tsx
import { useRef } from "react";
import { CanonicalAuthorityEditor, type SmartEditorHandle } from "smartrte-react";

function Editor() {
  const ref = useRef<SmartEditorHandle>(null);

  const loadDocument = (doc) => ref.current?.replaceValue(doc, { keepSelection: false });
  const currentDoc = () => ref.current?.getValue();

  return <CanonicalAuthorityEditor ref={ref} />;
}
```

```ts
interface SmartEditorHandle {
  getValue(): PersistedEditorDocument;
  replaceValue(doc: PersistedEditorDocument, opts?: { keepSelection?: boolean }): void;
  isDirty(): boolean;
  markSaved(revision: number): void;
  getRevision(): number;
  focus(): void;
  executeOperations(operations: readonly SmartOperation[], opts?: ExecuteOperationsOptions): void;
  createCheckpoint(): SmartEditorCheckpoint;
  restoreCheckpoint(checkpoint: SmartEditorCheckpoint): void;
  saveVersion(opts?: { label?: string; authorId?: string }): DocumentVersion;
  restoreVersion(version: DocumentVersion, opts?: { keepSelection?: boolean }): void;
}
```

`saveVersion`/`restoreVersion` are the same operations the toolbar's Version History panel calls — use them directly if you want your own save-version UI instead of (or alongside) the built-in one.

## Import & export formats

The toolbar's "Import" and "Save as ..." tools cover HTML, Markdown, DOCX (Word), PDF, and the package's own JSON document format out of the box — no extra setup. DOCX import preserves real Word styling (fonts, colors, spacing) where possible; PDF export prints the same HTML the editor renders, so formulas, tables, and images all appear as they do live.

For a custom import/export pipeline (e.g. converting on a server, or a "Save as..." flow outside the toolbar), the underlying codecs are re-exported from `smartrte-core/foundation`: `exportDocxDocument`, `importDocxDocumentWithMammoth`, `importStyledDocxDocument`, `buildPdfPrintDocument`, `importPdfDocument`, and the format-fidelity contract (`builtInFormatFidelity`) describing exactly what's lossless vs. lossy per format.

## Theming

The editor uses CSS custom properties for every color — there's no `theme` prop; dark mode is a CSS class.

```tsx
<CanonicalAuthorityEditor className="srte-dark" />
```

```css
/* Or follow system preference yourself and toggle the class conditionally */
@media (prefers-color-scheme: dark) {
  .srte-editor:not(.srte-dark) { /* your own light/dark logic here */ }
}
```

Override individual variables (scoped to your own class, composed alongside `srte-dark` or standalone) to build a custom palette:

```css
.my-theme {
  --srte-background: #1a1a2e;
  --srte-foreground: #eaeaea;
  --srte-border: #3a3a5c;
  --srte-accent: #7c3aed;
  /* override only what you need - everything else falls back to the default */
}
```

| Variable | Description |
|---|---|
| `--srte-background` / `--srte-canvas` | Toolbar/chrome background vs. editing-surface background |
| `--srte-foreground` / `--srte-muted-foreground` | Primary vs. secondary text |
| `--srte-border` | Standard border color |
| `--srte-ring` | Focus ring color |
| `--srte-accent` / `--srte-accent-bg` | Selection/active-state color and its translucent background |
| `--srte-primary` / `--srte-on-primary` | Primary action button background/text |
| `--srte-danger` | Destructive action color |
| `--srte-modal-bg` / `--srte-modal-backdrop` | Dialog background and overlay |
| `--srte-menu-bg` / `--srte-menu-shadow` | Dropdown/context-menu background and shadow |
| `--srte-code-bg` / `--srte-code-text` | Code block colors |

These fall back to sensible defaults, and also read from common shadcn/ui-style tokens (`--card`, `--background`, `--foreground`, `--muted`, `--border`, `--ring`) if your app already defines those — so a Tailwind/shadcn app may need no overrides at all. Colors set via the color picker (text/background) are inline styles on content and are unaffected by theming — only editor chrome (toolbar, dialogs, menus) is themed.

## Standalone / non-React embed

For a host that isn't a React app (or embeds via WebView — the [Flutter package](https://github.com/ayush1852017/smart-rte/tree/master/dart/smartrte_flutter) uses exactly this), a global-script build is available:

```ts
import "smartrte-react/standalone/classic-editor-embed";

window.SmartRTE.ClassicEditor.init({
  target: document.getElementById("editor"),
  value: "<p>Hello</p>",
  tools: { video: false, audio: false },
  onChange: (html) => console.log(html),
});
```

Returns a controller: `{ setHtml, getHtml, focus, blur, destroy }`.

## Security

The editor outputs HTML and never persists anything itself — storage, credentials, and the actual save are always the host's. Pasted HTML is sanitized on the way in (DOMPurify), but **always sanitize before rendering elsewhere**: if you take the editor's HTML output and `dangerouslySetInnerHTML` it in a different context (an email, a public page), treat it the same as any other user-generated HTML.

```tsx
import DOMPurify from "dompurify";

function DisplayContent({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}
```

Found a security issue? Please email support@openstash.in rather than opening a public issue.

## Browser support

Chromium, Firefox, and WebKit (Safari) — the full end-to-end suite runs against all three, headless and current, on every change.

## Development

This package lives in a pnpm workspace monorepo alongside `smartrte-core`.

```bash
git clone https://github.com/ayush1852017/smart-rte.git
cd smart-rte
pnpm install
pnpm build          # builds every package
```

```bash
# Live playground (aliased to workspace source, not the built dist - edits hot-reload)
cd packages/react/playground
pnpm install
pnpm dev             # http://localhost:5173
```

```bash
# From packages/react
pnpm test            # vitest unit suite
pnpm e2e             # Playwright, all 3 browsers
pnpm storybook       # component stories, http://localhost:6006
```

## Contributing

Issues and PRs are welcome at [github.com/ayush1852017/smart-rte](https://github.com/ayush1852017/smart-rte/issues). For a bug report, include a minimal repro, expected vs. actual behavior, and your browser/OS. For a PR: keep it focused on one change, add test coverage (unit and/or a Playwright spec, matching whichever existing test file is closest to what you touched), and run `pnpm build && pnpm test` before pushing.

## License

MIT — see [LICENSE](https://github.com/ayush1852017/smart-rte/blob/master/LICENSE).
