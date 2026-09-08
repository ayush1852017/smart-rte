# smartrte-core

[![npm version](https://img.shields.io/npm/v/smartrte-core.svg)](https://www.npmjs.com/package/smartrte-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Framework-agnostic document model, selection, transaction, and editing primitives that power [`smartrte-react`](https://www.npmjs.com/package/smartrte-react). Everything here is plain TypeScript with no DOM/React dependency in its core data structures — schema, operations, and history all operate on a plain JSON document tree.

**If you're building a React app, install `smartrte-react` instead** — it depends on this package and re-exports everything you're likely to need. Install `smartrte-core` directly only if you're building a custom editing surface (a different UI framework, a headless document pipeline, a server-side format converter) on top of the same document model.

## Install

```bash
npm install smartrte-core
```

## What's in here

```ts
import {
  createFoundationEditor,
  foundationSchema,
  createPluginRegistry,
  builtInPlugins,
} from "smartrte-core/foundation";
```

- **Document model & schema** (`types`, `schema`, `identity`) — a plain JSON tree of typed nodes (paragraph, heading, list, table, image, formula, ...), each with a stable id that survives edits.
- **Editing engine** (`editor`, `transactions`, `operations`, `history`) — `createFoundationEditor` builds a stateful editor: dispatch a transaction, get back an updated document plus mapped selection, with full undo/redo.
- **Selection & scope resolution** (`scope/`) — resolves "what does the current selection actually touch" (a text range, a set of list items, a table-cell rectangle, a mix) so commands can act on the right thing regardless of how deeply nested it is.
- **Browser input surface** (`surface/`) — the `beforeinput`/paste/cut/drop/composition handling layer a real contentEditable-backed UI wires up to; this is what `smartrte-react` builds its editing surface on.
- **Format adapters** (`formats/`) — HTML, Markdown, DOCX (via `mammoth`/`@xmldom`), and PDF (`pdfjs-dist`) import/export, each declaring an explicit fidelity contract (`builtInFormatFidelity`) for exactly what's lossless vs. lossy per format/feature pair.
- **Diff, versioning, comments, suggestions, plugin system** (`diff/`, `versioning/`, `comments/`, `suggestions/`, `plugin/`) — the primitives `smartrte-react`'s version history, comment threads, and track-changes UI are built on. A `PluginRegistry` (`createPluginRegistry`, `builtInPlugins`) is how new commands, keyboard shortcuts, toolbar contributions, and renderer behavior are added — see [`docs/PLUGIN_ARCHITECTURE.md`](https://github.com/ayush1852017/smart-rte/blob/master/docs/PLUGIN_ARCHITECTURE.md) in the repository.
- **Collab contract** (`collab/`) — the operation-transform machinery (`mapOperation`) a real-time transport would rebase concurrent edits through. A contract for hosts building multi-writer collaboration against; no transport implementation ships here.

## Subpath exports

```json
{
  ".": "compatibility root (legacy pre-foundation API)",
  "./foundation": "the current, actively-developed API - use this",
  "./legacy": "retired raw-path contracts, kept only for migration"
}
```

New code should import from `smartrte-core/foundation` exclusively. The package root is a compatibility surface for older integrations; it is not where new capability lands.

## Security

Format importers (HTML, DOCX, PDF) sanitize what they parse (DOMPurify for HTML), but this package holds no storage credentials and performs no network I/O itself — persistence, uploads, and real-time transport are all host-owned boundaries (see `smartrte-react`'s `MediaProvider`/`VersionProvider`/`CommentProvider`/`SuggestionProvider`/`CollabTransport`).

## Development

This package lives in a pnpm workspace monorepo alongside `smartrte-react`.

```bash
git clone https://github.com/ayush1852017/smart-rte.git
cd smart-rte
pnpm install
pnpm --filter smartrte-core build
pnpm --filter smartrte-core test
```

## License

MIT — see [LICENSE](https://github.com/ayush1852017/smart-rte/blob/master/LICENSE).
