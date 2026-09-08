# Smart RTE

[![smartrte-react npm version](https://img.shields.io/npm/v/smartrte-react.svg?label=smartrte-react)](https://www.npmjs.com/package/smartrte-react)
[![smartrte-core npm version](https://img.shields.io/npm/v/smartrte-core.svg?label=smartrte-core)](https://www.npmjs.com/package/smartrte-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A rich text editor built on a real document model, not raw `contentEditable` state — tables, LaTeX/KaTeX formulas, media, DOCX/PDF/Markdown import-export, and host-owned integration points for version history, comments, and suggestions/track-changes.

This is a monorepo with two published npm packages plus a Flutter integration:

| Package | What it is |
|---|---|
| [**smartrte-react**](packages/react) | The React component (`CanonicalAuthorityEditor`) and toolbar — what you install if you're building a React app. **[Full developer guide →](packages/react/README.md)** |
| [**smartrte-core**](packages/core) | The framework-agnostic document model, editing engine, and format adapters `smartrte-react` is built on. Install this directly only if you're building a custom editing surface. **[Guide →](packages/core/README.md)** |
| [**smartrte_flutter**](dart/smartrte_flutter) | A Flutter WebView wrapper around the React editor's standalone embed build. |

## Quick start

```bash
npm install smartrte-react
```

```tsx
import { useState } from "react";
import { CanonicalAuthorityEditor } from "smartrte-react";

function App() {
  const [content, setContent] = useState("<p>Start typing…</p>");
  return <CanonicalAuthorityEditor defaultValue={content} onHtmlChange={setContent} />;
}
```

See [`packages/react/README.md`](packages/react/README.md) for the full guide: props, per-tool toolbar visibility, the media/version-history/comments/suggestions provider system, theming, and the standalone non-React embed.

## Features

- **Rich text editing** on a real document model — tables, headings, lists (with named marker presets), blockquotes, code blocks, links, checklists.
- **Tables**: merge/split cells, row/column insert-delete, per-cell borders and background, resizable columns/rows.
- **LaTeX/KaTeX formulas**, inserted via a searchable formula library.
- **Media**: image/video/audio insertion with a host-owned upload/search boundary (`MediaProvider`) — the package never touches your storage credentials.
- **Import/export**: HTML, Markdown, DOCX (real Word styling preserved on import), PDF (prints the editor's own rendered HTML — formulas and tables included), and the package's own JSON format.
- **Version history, comments, and suggestions/track-changes** — each behind its own host-implemented provider interface, so a host only takes on the features it actually wants to support.
- **Per-tool toolbar visibility** — hide any toolbar entry without forking the component or overriding CSS.
- **Real-time collaboration contract** (`CollabTransport`) — the operation-transform machinery a transport implementation rebases through; defined and tested, not yet wired into the runtime.
- Cross-browser (Chromium/Firefox/WebKit) end-to-end test coverage on every change.

## Repository structure

```
smart-rte/
├── packages/
│   ├── core/      # smartrte-core - framework-agnostic document engine
│   └── react/     # smartrte-react - the React component + toolbar
│       └── playground/   # live dev playground (Vite, aliased to workspace source)
├── dart/
│   ├── smartrte_flutter/  # Flutter WebView integration
│   └── example_app/       # Flutter example
└── docs/          # architecture decisions, phase records, bug ledger
```

## Development

```bash
git clone https://github.com/ayush1852017/smart-rte.git
cd smart-rte
pnpm install
pnpm build     # builds every package
pnpm test      # unit tests, every package
pnpm lint      # typecheck + architectural boundary checks
```

```bash
# Live playground - edits to packages/react or packages/core hot-reload immediately
cd packages/react/playground
pnpm install
pnpm dev       # http://localhost:5173
```

End-to-end tests (Playwright, 3 browsers) live in `packages/react/e2e`:

```bash
cd packages/react
pnpm e2e
```

## Contributing

Issues and PRs are welcome at [github.com/ayush1852017/smart-rte/issues](https://github.com/ayush1852017/smart-rte/issues). For a bug report: a minimal repro, expected vs. actual behavior, and your browser/OS. For a PR: keep it focused on one change, add test coverage, and run `pnpm build && pnpm lint && pnpm test` before pushing.

Every fixed bug gets a short write-up in [`docs/bugs/`](docs/bugs/) — worth a search before re-investigating something that looks familiar.

## Security

The editor outputs HTML and never persists anything itself; storage, credentials, and the actual save are always host-owned. Pasted content is sanitized on the way in, but if you render the editor's HTML output elsewhere, sanitize it again for that context (e.g. [DOMPurify](https://github.com/cure53/DOMPurify)). Found a security issue? Please email support@openstash.in rather than opening a public issue.

## License

MIT — see [LICENSE](LICENSE).
