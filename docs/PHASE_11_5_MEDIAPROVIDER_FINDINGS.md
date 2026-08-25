# Phase 11.5 §1.1 — `MediaProvider` investigation findings

Required pre-work before any UI implementation, per Phase 11.5's own gate 2 ("Do not assume the interface is sufficient. Do not assume it's insufficient. Check."). No reference material for "the old Sootr editor's `MediaManager.js`" (screenshots, a separate old codebase) exists anywhere in this repository or its git history — searched by filename (`MediaManager.js`, case-insensitive) and by `git log --all`, zero hits. The investigation below is therefore grounded entirely in what does exist in this repo, which turned out to be substantial and directly relevant.

## The headline finding: a full-featured media library UI already exists, unwired

`packages/react/src/components/MediaManager.tsx` (395 lines) is a complete, already-built React component implementing almost exactly Work Item 2.1's described feature set:
- **Upload tab**: click-to-browse or drag-and-drop.
- **Library tab**: debounced search, results grid.
- **Duplicate detection**: computes a real SHA-256 hash of each file client-side, looks it up via `search({hashHex})` before uploading; on a hit, selects the existing item instead of re-uploading.
- **Per-asset info panel**: Title, Alt text, Dimensions, MIME type, Size, Created, Tags, Work, Author, License (type + text), Source — covering 9 of the 10 spec-named fields (Link, Alt, License, Author, License type, Attribution text are present or near-equivalent; Target, Radius, Align, and a literal "Width" *editable field* are not — see gaps below).

**It is not wired into the live product.** `grep` for `MediaManager` outside its own file finds only a re-export in `packages/react/src/index.ts` — `CanonicalAuthorityEditor.tsx` never imports or renders it. The actual live picker is `packages/react/src/components/MediaPicker.tsx`'s `DefaultMediaPicker` — a bare file-input dialog with no library, search, duplicate detection, or metadata editing, whose own doc comment already anticipates this: *"Small replaceable default; hosts can supply a library/search picker later."* `MediaManager.tsx` also has zero test coverage anywhere (no unit test file, no e2e reference) — built, never even exercised.

This is the same "real code exists but was never connected" shape found repeatedly elsewhere in this project (Phase 10's `pluginRuntime.ts`, Tier 0's `resolveShortcut`) — checked for specifically because of that pattern, not assumed.

## Does the current `MediaProvider` interface need new methods? — No, but the two existing UI-layer types don't match it

The three-method interface (`upload`/`search`/`remove`) is sufficient for everything `MediaManager.tsx` already does, including duplicate detection (`search({hashHex})`, already implemented). **No new `MediaProvider` method is needed.**

However, `MediaManager.tsx` was built against its own `MediaManagerAdapter` type, not `MediaProvider` directly, and the shapes don't match:
- `MediaManagerAdapter.upload(files: File[]) => Promise<MediaItem[]>` (plural, batch) vs. `MediaProvider.upload(file: File, opts?) => Promise<{url, id}>` (singular, returns only a URL/id pair — not a full `MediaItem`).
- `MediaManagerAdapter.search(query: MediaSearchQuery)` bundles free-text `q` into one object, vs. `MediaProvider.search(query: string, filters?: MediaFilters, page?: number)` — free text is a separate positional parameter.
- `MediaProvider.upload`'s return value has no `MediaItem` fields (no `width`/`height`/`mimeType`/etc.) — `MediaManager.tsx`'s upload flow expects the uploaded item back with full metadata to select it immediately.

None of this requires changing `MediaProvider`'s contract — it requires a thin adapter function translating `MediaProvider` calls into `MediaManagerAdapter`'s shape (e.g., wrap `upload` to call `MediaProvider.upload` then immediately `search({hashHex: <computed>})` or construct a `MediaItem` from what's known client-side plus the returned `{url, id}`).

## Does `MediaItem` need extending? — Yes, one real gap: usage-count tracking

`MediaItem` (`mediaProvider.ts`) already has every field `MediaManager.tsx`'s info panel displays: `id, url, width, height, sizeBytes, mimeType, hashHex, createdAt, title, alt, tags, license: {author, licenseType, licenseText, sourceUrl, workName}`.

**Usage-count ("used N times") does not exist anywhere** — not in `MediaItem`, not in `MediaProvider`, not computed anywhere in the codebase. Two ways to get it, genuinely different in kind:
1. **Client-side, computed from the live document**: walk `editor.document` for atom nodes whose `src`/`hashHex` matches a library item, count matches. Always accurate for the currently-open document, free (no interface change), but only knows about *this* document, not usage across a host's whole content library (which is what "used N times" most likely means for a shared media library across many documents).
2. **Server-side, via a new optional `MediaItem.usageCount?: number` field**: the host's backend would need to track cross-document usage and return it from `search`/list calls. A real interface extension (additive, non-breaking — an optional field), but only meaningful if a host actually implements that tracking; the package itself has no way to verify usage across documents it doesn't have access to.

**Recommendation: add `MediaItem.usageCount?: number` (optional, additive), and have the default library UI display it when present, falling back to not showing it when absent.** This matches the project's established `MediaProvider` boundary (the package doesn't do server-side work; a host that wants real cross-document usage tracking implements it and returns the number; a host that doesn't just doesn't populate the field). Does not require a new `MediaProvider` method.

## Field-set gap: what's missing vs. the spec's list

Spec: *"Link, Target, Alt, Width, Radius, Align, License, Author, License type, Attribution text."* Currently in `MediaItem`/atom attrs:
- **Present**: Alt (`MediaItem.alt`, and separately `imageAttrs.alt` on the atom node itself), Width (`MediaItem.width`, display-only in the info panel; the atom node's own `width` attr is the actually-editable one, via the existing resize controls), License/Author/License type (`MediaItem.license.*`).
- **Present but not exactly matching**: "Attribution text" — `MediaItem.license.licenseText` is the closest existing field; whether the spec means this or a genuinely separate field is a naming/UX decision, not a missing-capability question.
- **Missing entirely from both `MediaItem` and atom attrs**: Target (link behavior for the image, e.g. open-in-new-tab), Radius (border-radius styling). These are UI/atom-attribute concerns, not `MediaProvider` concerns — they'd be new `imageAttrs` entries (`atom/schema.ts`) plus renderer support, unrelated to the provider interface question this investigation was scoped to answer.
- **Align**: already exists as `imageAttrs.align` (`"center" | "left" | "right"`) — a UI-only gap (no control in `MediaManager.tsx`'s info panel currently edits it), not a data-model gap.

## Conclusion

- `MediaProvider`'s core contract (`upload`/`search`/`remove`) does **not** need new methods.
- `MediaItem` needs **one** real, additive extension: optional `usageCount`.
- The actual Work Item 2.1 effort is **wiring and adapting `MediaManager.tsx`** (build a thin `MediaProvider`-to-`MediaManagerAdapter` translation, add the usage-count display, add Target/Radius/Align editing controls to the info panel, wire real `remove()` support since the current component has no delete action at all despite `MediaProvider.remove` existing) **and testing it** (zero tests exist today) — not building a media library UI from scratch. This changes Work Item 2.1's shape substantially from what the spec's framing implied ("built... not a port of the old component's code" assumed no reusable code existed).
