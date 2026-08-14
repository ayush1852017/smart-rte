# DOCX import is reachable-DoS via mammoth's own bundled, vulnerable `@xmldom/xmldom@0.8.11`

**Status:** Open — the pnpm override plus a scoped patch to mammoth's `mimeType` argument (option 2) was tried; it fixed the mimeType crash but surfaced a second, independent incompatibility (mammoth's error-handling treats xmldom 0.9.x's constructor-time deprecation notice as a fatal parse error) that would require patching beyond the authorized minimal scope. Both attempts fully reverted. Still unfixed.
**Area:** formats / docx / security
**First reported:** 2026-08-13, Phase 9 closeout item 3 (dependency vulnerability scan)
**Related files:** `docs/bugs/published-npm-versions-predate-canonical-rebuild.md` (unrelated cause, same area)

## Symptom

Phase 9's completion report disclosed that no vulnerability scan had been run against the 5 runtime dependencies added that phase (`katex`, `jszip`, `mammoth`, `pdfjs-dist`, `@xmldom/xmldom`). Running `pnpm audit` closed that gap and found a real, reachable finding specifically in `mammoth`.

## Reproduction

`pnpm audit --json` from the repo root; cross-referenced with `pnpm -r why @xmldom/xmldom` to confirm the exact resolved versions and dependency paths.

```
pnpm -r why @xmldom/xmldom
```
shows **two separate resolutions** in the tree:
- `packages/core`'s own direct dependency: `@xmldom/xmldom@0.9.11` (the version explicitly pinned in Phase 9 §2.1 to avoid a deprecated `0.8.11` resolution — this one is fine).
- `mammoth@1.11.0`'s **own internal** dependency: `@xmldom/xmldom@0.8.11` — completely independent of the top-level pin, present in every package that depends on `mammoth` (`packages/core`, `packages/react`, and transitively `packages/react/playground`).

## Root cause

`mammoth@1.11.0` declares its own `@xmldom/xmldom` dependency (resolving to `0.8.11`) rather than accepting whatever version the consuming project provides. Pinning our own direct usage to `^0.9.11` (`packages/core/src/foundation/formats/docx/styledImport.ts:2`, which imports `DOMParser` directly) does not affect mammoth's private copy — pnpm's non-hoisted resolution gives each package its own dependency tree unless explicitly overridden.

`0.8.11` is vulnerable to 5 advisories, all fixed in `>=0.8.12`/`>=0.8.13`:
- GHSA-wh4c-j3r5-mjhp — XML injection via unsafe CDATA serialization
- GHSA-2v35-w6hq-6mfw — uncontrolled recursion in XML traversal/serialization, DoS
- GHSA-f6ww-3ggp-fr8h — XML injection via unvalidated DocumentType serialization
- GHSA-x6wf-f3px-wcqx — XML node injection via unvalidated processing-instruction serialization
- GHSA-j759-j44w-7fr8 — XML node injection via unvalidated comment serialization

**Reachability triage** (not just raw audit output): checked mammoth's actual source (`node_modules/.pnpm/mammoth@1.11.0/node_modules/mammoth/lib/`) for which xmldom operations it actually calls.
- Mammoth uses `xmldom.DOMParser` exactly once (`lib/xml/xmldom.js:7`) and **never** calls `XMLSerializer` anywhere in its codebase — confirmed via `grep -rn "XMLSerializer" lib/`, zero matches. This means the 4 *serialization*-injection advisories (CDATA/DocumentType/PI/comment) are **not reachable** through mammoth's usage: they all require the application to construct DOM nodes from attacker content and then serialize them, and mammoth never serializes.
- The 5th advisory (uncontrolled recursion) **is reachable**: its own text explicitly lists `DOMParser.parseFromString()` as a reported trigger vector (via cross-referenced GHSA-fwmp-8wwc-qhv6), and separately confirms `Element.getElementsByTagName()` is one of seven affected recursive operations. Mammoth's own DOCX-parsing code (`lib/docx/numbering-xml.js`, `styles-reader.js`, `body-reader.js`, `comments-reader.js`, `notes-reader.js`) calls `.getElementsByTagName()` extensively and unconditionally on every parsed document — this is not an edge case, it is mammoth's normal, always-executed parsing path.
- Our entry point is `importDocxDocumentWithMammoth` (`packages/core/src/foundation/formats/docx/import.ts:13`), which calls `mammoth.convertToHtml({ arrayBuffer, ... })` directly on caller-supplied bytes. A `.docx` file is a ZIP of XML; an attacker who can get a user to import a crafted `.docx` (a routine, expected use of this feature) can trivially construct XML nested ~10,000 levels deep (the disclosed PoC is literally `'<a>'.repeat(depth) + 'text' + '</a>'.repeat(depth)`) and crash the import with `RangeError: Maximum call stack size exceeded` — in a browser context, an uncaught error in the import flow; if this code ever runs server-side, a process-level crash.

## Fix

**Attempted and reverted; still open.** The originally recommended fix — a pnpm override forcing `@xmldom/xmldom` to `^0.9.11` everywhere, including inside mammoth's resolution — was applied, confirmed effective at the dependency-resolution level, and then found to break DOCX import completely.

```json
"pnpm": { "overrides": { "@xmldom/xmldom": "^0.9.11" } }
```

**Verification that the override itself worked correctly:** after `pnpm install`, `pnpm -r why @xmldom/xmldom` showed exactly one resolved version (`0.9.11`) everywhere in the tree, including inside `mammoth@1.11.0`'s own dependency (previously `0.8.11`). `pnpm audit` confirmed all 5 `@xmldom/xmldom` advisories gone (high-severity count dropped from 33 to 28, an exact match). The override mechanism is not the problem.

**What actually broke:** every DOCX import test failed with `TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.` Root cause, confirmed by reading both sides directly:
- Mammoth's own internal call site (`node_modules/mammoth/lib/xml/xmldom.js:13`, `exports.parseFromString`) calls `domParser.parseFromString(string)` with a **single argument** — it never passes a `mimeType`.
- `@xmldom/xmldom`'s `DOMParser.prototype.parseFromString` (`lib/dom-parser.js`) validates `mimeType` with `isValidMimeType(mimeType)` **before** applying its own documented default (the JSDoc directly above it states `@param {string} [mimeType='application/xml']`). Passing `undefined` does not fall through to that default — it throws a `TypeError` immediately. This directly contradicts the function's own documentation.
- Confirmed via direct testing (`npm pack @xmldom/xmldom@0.9.0`, inspecting `lib/dom-parser.js`) that this validate-before-default behavior exists starting at `0.9.0` and is present in every 0.9.x release, not a `0.9.11`-specific issue — no other 0.9.x version would avoid this. Picking a different patch version within 0.9.x is a confirmed dead end, not just an untried option.
- Our own direct `@xmldom/xmldom` usage (`packages/core/src/foundation/formats/docx/styledImport.ts:197`) was never affected, since it always passes an explicit `"text/xml"` as the second argument. The incompatibility is specific to mammoth's calling convention, not a general problem with our own code.

The override was reverted (`package.json`, `pnpm-lock.yaml` restored to their pre-override committed state, `pnpm install` re-run); confirmed `pnpm -r why @xmldom/xmldom` shows mammoth back on `0.8.11` and the full DOCX/core/react test suites pass again at their prior counts (see completion note below). This means the DoS finding above is **still live and unfixed** — reverting restored the vulnerable-but-working state, not a fixed one.

## Second attempt: pnpm override + a scoped `pnpm patch` for mammoth (option 2)

Re-applied the override (confirmed effective again exactly as before: single `0.9.11` resolution tree-wide, all 5 advisories gone from `pnpm audit`). Then used `pnpm patch mammoth@1.11.0` to fix the actual root cause of the first attempt's break: mammoth's own `lib/xml/xmldom.js` exports a local `parseFromString(string)` wrapper that silently drops a second argument — confirmed by reading mammoth's own caller, `lib/xml/reader.js:16`, which already calls `xmldom.parseFromString(xmlString, "text/xml")`, fully intending to pass a mimeType. The wrapper (`lib/xml/xmldom.js:4`) just never declared the parameter or forwarded it to the real `domParser.parseFromString(string)` call at line 13. This is a pre-existing bug in mammoth's own code, independent of which xmldom version is installed — it simply never mattered under `0.8.11`'s more permissive validation.

**Patch applied** (`patches/mammoth@1.11.0.patch`, via `pnpm patch-commit`), a genuine one-line-per-site, two-line diff:

```diff
-function parseFromString(string) {
+function parseFromString(string, mimeType) {
...
-    var document = domParser.parseFromString(string);
+    var document = domParser.parseFromString(string, mimeType);
```

This correctly forwards mammoth's own already-intended `"text/xml"` rather than hardcoding a new value — the more minimal and more correct of the two options the task allowed.

**This fixed the mimeType crash** — re-running `docx/format.test.ts` no longer hit the `TypeError` from the first attempt. **But a second, different failure appeared in its place:**

```
Error: warning: The `errorHandler` option has been deprecated, use `onError` instead!
 at Object.parseFromString .../mammoth/lib/xml/xmldom.js:18
 at Object.readString .../mammoth/lib/xml/reader.js:16
```

Root cause, confirmed by reading `@xmldom/xmldom`'s `dom-parser.js` constructor directly:

```js
this.onError = options.onError || options.errorHandler;
if (options.errorHandler && typeof options.errorHandler !== 'function') {
	throw new TypeError('errorHandler object is no longer supported, switch to onError!');
} else if (options.errorHandler) {
	options.errorHandler('warning', 'The `errorHandler` option has been deprecated, use `onError` instead!', this);
}
```

Mammoth's `DOMParser` construction (`lib/xml/xmldom.js:7-11`) still uses the old `errorHandler`-style callback (not the newer `onError`). xmldom 0.9.x's constructor, whenever `errorHandler` is provided at all, **immediately and unconditionally invokes that same callback with a synthetic `'warning'`-level deprecation notice** — before any actual parsing happens. Mammoth's own error-collection logic (`lib/xml/xmldom.js:8-10`) records *any* invocation of its `errorHandler` callback as `error = {level, message}` with no check on `level`, then throws after parsing if `error !== null`. The result: the deprecation notice about `errorHandler` itself gets funneled through `errorHandler` and mammoth treats it as a fatal parse failure on every single document, valid or not — completely independent of the mimeType fix, and completely independent of whether the input XML is well-formed.

**This is a second, separate incompatibility**, requiring a second patch (to mammoth's own `errorHandler` callback, to ignore `level === "warning"` messages, or to switch mammoth to the newer `onError` option) to actually resolve — beyond the single, one-line, one-function scope explicitly authorized for this pass. Per this project's standing rule against expanding a patch or working around a blocker unilaterally, **stopped here rather than continuing to patch.** Both the override and the mammoth patch were fully reverted (`package.json`, `pnpm-lock.yaml`, `patches/mammoth@1.11.0.patch` removed); confirmed `pnpm -r why @xmldom/xmldom` shows mammoth back on `0.8.11`, and the full DOCX/core/react/e2e suites pass again at their prior counts.

**Real options, updated — none applied, all still need explicit confirmation:**
1. ~~Patch mammoth's own dependency via `packageExtensions`~~ — ruled out (see first attempt above): no `@xmldom/xmldom` version both fixes the advisories and matches mammoth's original calling convention.
2. **Extend the mammoth patch to also fix the `errorHandler`→`onError` incompatibility** — the mimeType half of this patch is proven correct and ready to keep; a second, similarly-scoped change (either filtering `level === "warning"` in mammoth's callback, or switching its `DOMParser` construction to use `onError` instead of `errorHandler`) would need the same test-and-verify treatment this pass gave the first half. Most promising path, but is a new scope decision, not a continuation of what was authorized here.
3. Replace `mammoth` with a different DOCX-to-HTML library entirely — a much larger change, affecting `importDocxDocumentWithMammoth`'s whole implementation, not just a dependency version.
4. Accept the DoS as a documented, tracked residual risk — rejected explicitly for this finding (a live crash-on-routine-use path, not comparable to already-waived coverage-gap items like the native Word capture gap).
5. **Report upstream to `@xmldom/xmldom`** — drafted (title, repro, and a description of *both* incompatibilities found: the mimeType default not applying, and the errorHandler-deprecation notice firing through itself), but **not filed**: this environment has no `gh` CLI installed and no other GitHub-posting mechanism available. Draft is saved at `/private/tmp/claude-501/-Users-ayushbajpai-Developer-smart-rte/181fecaf-5e02-4a7a-850b-7821cc5ba97c/scratchpad/xmldom-upstream-issue-draft.md` (session-scoped scratch path — copy its contents before that session's temp storage is cleared) and reproduced in full in this entry below for permanence.

### Drafted upstream issue (not filed — no `gh` access in this environment)

> **Title:** `parseFromString`'s documented default `mimeType` isn't applied when the argument is omitted — throws instead
>
> **Summary:** `DOMParser.prototype.parseFromString`'s JSDoc states `@param {string} [mimeType='application/xml']`, implying a default when omitted. The implementation validates `mimeType` with `isValidMimeType(mimeType)` *before* applying that default, so `parseFromString(xmlString)` with no second argument throws `TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.` instead of defaulting. Confirmed present in every `0.9.x` release from `0.9.0` through `0.9.11`.
>
> **Repro:** `new (require('@xmldom/xmldom').DOMParser)().parseFromString('<root/>')` throws.
>
> **Separately, a related issue:** the constructor's `errorHandler`-deprecation notice (`options.errorHandler('warning', 'The errorHandler option has been deprecated...', this)`, fired unconditionally and immediately whenever `errorHandler` is passed) is routed through the same callback consumer code uses to detect real parse errors, giving old-API consumers no way to distinguish "your XML is malformed" from "you're still using the deprecated option name" — found via `mammoth`, which collects any `errorHandler` invocation as fatal.
>
> **Suggested fix:** apply the documented default before validating, not after; consider a less disruptive channel for the `errorHandler`-deprecation notice than the callback itself.

## Regression coverage

None — no fix is in place. `packages/core/src/foundation/formats/docx/format.test.ts` already exercises `importDocxDocumentWithMammoth` on every run and is exactly what caught both the override's original breakage and the second attempt's follow-on breakage; it will also catch a regression from whichever real fix is eventually chosen.

## Related/similar issues

None with the same root cause. This is the first dependency-supply-chain finding in this project's history — distinct in kind from the application-logic bugs this ledger otherwise records.
